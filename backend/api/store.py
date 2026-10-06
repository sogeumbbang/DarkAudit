"""
DB 기반 저장소
-------------
MemoryStore 를 대체한다. 서버가 재시작되어도 감사 결과가 남아야 하고,
회차(AuditRun)를 보관해야 Before/After 재검증이 가능하기 때문이다.

프론트 호환

    AuditDto.findings 에는 **최신 완료 Run 의 결과**를 그대로 내려준다.
    내부 구조가 Audit → AuditRun → Finding 으로 바뀌어도 프론트는 기존과
    동일하게 동작한다. runs / latestRunId 는 추가 필드이므로 무시해도 무해하다.
"""

from __future__ import annotations

import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

from ai.vision.bbox_refinement import (
    refine_prominent_cta_bbox,
    refine_selected_control_bbox,
)
from backend.app.models import (
    Audit, AuditRun, Base, Element, Evidence, Finding,
    FindingRelatedElement, RunStatus, Screen, Severity,
)
from backend.app.regression import RegressionReport

from . import compat
from .schemas import (
    AuditDto, AuditRunDto, BBox, ElementRef, FindingDto, RegressionChangeDto,
    RegressionDto, ScreenDto,
)

DB_URL = os.getenv("DARKAUDIT_DB_URL", "sqlite:///data/darkaudit.db")
DATA_DIR = Path(__file__).resolve().parents[2] / "data"

_engine = create_engine(DB_URL, future=True, connect_args=(
    {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
))
SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)


def init_db() -> None:
    if DB_URL.startswith("sqlite:///"):
        path = DB_URL.replace("sqlite:///", "")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    Base.metadata.create_all(_engine)
    with _engine.begin() as connection:
        connection.execute(text("""INSERT INTO audit_sequence (id, value)
            SELECT 1, (SELECT COALESCE(MAX(id), 0) FROM audit)
            WHERE NOT EXISTS (SELECT 1 FROM audit_sequence WHERE id = 1)"""))
    audit_columns = {column["name"] for column in inspect(_engine).get_columns("audit")}
    for column, sql_type in (("owner_id", "VARCHAR(64)"), ("artifact_secret", "VARCHAR(64)")):
        if column not in audit_columns:
            with _engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE audit ADD COLUMN {column} {sql_type}"))
    if "updated_at" not in audit_columns:
        with _engine.begin() as connection:
            connection.execute(text("ALTER TABLE audit ADD COLUMN updated_at TIMESTAMP"))
            connection.execute(text("UPDATE audit SET updated_at = created_at"))
    if "demo_preset" not in audit_columns:
        with _engine.begin() as connection:
            connection.execute(text("ALTER TABLE audit ADD COLUMN demo_preset JSON"))
    columns = {column["name"] for column in inspect(_engine).get_columns("screen")}
    if "flow_step" not in columns:
        with _engine.begin() as connection:
            connection.execute(text("ALTER TABLE screen ADD COLUMN flow_step VARCHAR(200)"))
    for table, column in (("audit_run", "analysis_summary"), ("screen", "analysis_context")):
        existing = {item["name"] for item in inspect(_engine).get_columns(table)}
        if column not in existing:
            with _engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} JSON"))

    existing = {item["name"] for item in inspect(_engine).get_columns("finding")}
    for column, sql_type in (("decision_note", "TEXT"), ("decision_updated_at", "TIMESTAMP")):
        if column not in existing:
            with _engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE finding ADD COLUMN {column} {sql_type}"))

    # Records created before image signing also belong to the public workspace.
    # Preserve existing secrets so already-issued image URLs keep working.
    with SessionLocal() as session:
        for audit in session.scalars(select(Audit).where(Audit.artifact_secret.is_(None))):
            audit.artifact_secret = secrets.token_hex(32)
        session.commit()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def allocate_audit_id(session: Session) -> int:
    # Also accommodate legacy/imported rows above the counter. The update and
    # audit insert share a transaction, including on migrated SQLite databases.
    return session.execute(text("""UPDATE audit_sequence SET value = CASE
        WHEN value < (SELECT COALESCE(MAX(id), 0) FROM audit)
        THEN (SELECT COALESCE(MAX(id), 0) FROM audit) + 1 ELSE value + 1 END
        WHERE id = 1 RETURNING value""")).scalar_one()


def aware(value: datetime) -> datetime:
    """SQLite drops timezone metadata; API timestamps must remain RFC 3339 compatible."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def touch_audit(session: Session, audit_id: int) -> None:
    audit = session.get(Audit, audit_id)
    if audit is not None:
        audit.updated_at = utcnow()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


# ---------------------------------------------------------------- 조회


def latest_completed_run(audit: Audit) -> AuditRun | None:
    done = [r for r in audit.runs if r.status is RunStatus.DONE]
    return max(done, key=lambda r: r.version) if done else None


def _bbox(el: Element | None, screen_ext: str, screens: dict[int, Screen]) -> BBox | None:
    """
    정규화 좌표를 원본 이미지 기준으로 되돌린다.

    프론트는 이미지 위에 그리므로 픽셀 좌표가 필요하다.
    viewport 정보가 없으면 정규화 좌표를 그대로 내리고 coordinateSystem 으로 표시한다.
    """
    if el is None:
        return None
    sc = screens.get(el.screen_id)
    if sc and sc.viewport_w and sc.viewport_h:
        return BBox(
            screenId=screen_ext,
            x=round(el.bbox_x * sc.viewport_w, 1),
            y=round(el.bbox_y * sc.viewport_h, 1),
            width=round(el.bbox_w * sc.viewport_w, 1),
            height=round(el.bbox_h * sc.viewport_h, 1),
            coordinateSystem="image",
        )
    return BBox(
        screenId=screen_ext,
        x=el.bbox_x, y=el.bbox_y, width=el.bbox_w, height=el.bbox_h,
        coordinateSystem="normalized",
    )


def _primary_bbox(
    finding: Finding,
    screen_ext: str,
    screens: dict[int, Screen],
) -> BBox | None:
    """Return a tighter visual anchor for legacy screenshot-only findings.

    DOM captures already contain exact browser geometry. Uploaded screenshots do
    not, so the model's coarse DA-04 box is snapped to a nearby selected control.
    This happens while reading as well as while creating results, which also fixes
    previously stored audits without requiring another analysis run.
    """

    element = finding.primary_element
    if element is None or element.source != "vision" or finding.rule_id not in {"DA-03", "DA-04"}:
        return _bbox(element, screen_ext, screens)
    screen = screens.get(element.screen_id)
    if screen is None or not screen.image_path or not screen.image_path.startswith("/artifacts/"):
        return _bbox(element, screen_ext, screens)

    original = (element.bbox_x, element.bbox_y, element.bbox_w, element.bbox_h)
    image_path = DATA_DIR / screen.image_path.removeprefix("/artifacts/")
    refined = (
        refine_prominent_cta_bbox(str(image_path), original)
        if finding.rule_id == "DA-03"
        else refine_selected_control_bbox(str(image_path), original)
    )
    if refined == original:
        return _bbox(element, screen_ext, screens)

    x, y, width, height = refined
    if screen.viewport_w and screen.viewport_h:
        return BBox(
            screenId=screen_ext,
            x=round(x * screen.viewport_w, 1),
            y=round(y * screen.viewport_h, 1),
            width=round(width * screen.viewport_w, 1),
            height=round(height * screen.viewport_h, 1),
            coordinateSystem="image",
        )
    return BBox(
        screenId=screen_ext,
        x=x,
        y=y,
        width=width,
        height=height,
        coordinateSystem="normalized",
    )


RISK_TYPE_OF = {
    "DA-02": "DECEPTIVE_QUESTION",
    "DA-03": "VISUAL_HIERARCHY_DISTORTION",
    "DA-04": "PRESELECTED_OPTION",
    "DA-05": "FALSE_ADVERTISING",
    "DA-07": "HIDDEN_INFORMATION",
    "DA-11": "REPEATED_INTERFERENCE",
    "DA-12": "EMOTIONAL_LANGUAGE",
    "DA-13": "SENSORY_MANIPULATION",
    "DA-15": "SEQUENTIAL_PRICE_DISCLOSURE",
}


def to_finding_dto(
    f: Finding,
    screens_by_id: dict[int, Screen],
    screen_ext_id: dict[int, str],
    rules: dict,
    fid_of_rule: dict[str, str],
) -> FindingDto:
    rule = rules.get(f.rule_id, {})
    ev = f.evidence

    primary = f.primary_element
    p_screen = screen_ext_id.get(primary.screen_id, "") if primary else ""

    related = []
    for r in f.related:
        el = r.element
        sid = screen_ext_id.get(el.screen_id, "")
        related.append(ElementRef(
            screenId=sid,
            description=(el.text or el.element_type or "요소"),
            bbox=_bbox(el, sid, screens_by_id),
            elementType=el.element_type,
        ))

    screen_ids = []
    if f.screen_indices:
        screen_ids = [screen_ext_id[s.id] for s in screens_by_id.values()
                      if s.screen_index in f.screen_indices]
    elif primary:
        screen_ids = [p_screen]

    return FindingDto(
        id=f"finding-{f.id}",
        ruleId=f.rule_id,
        riskType=RISK_TYPE_OF.get(f.rule_id, "PRESELECTED_OPTION"),
        title=rule.get("official_name_ko", f.rule_id),
        description=" ".join(x for x in [ev.why_text if ev else None] if x) or "",
        screenIds=screen_ids,
        element=(primary.text if primary and primary.text else (ev.what_text if ev else "")) or "",
        severity=f.severity.value,
        status={"RESOLVED": "resolved", "REVIEWING": "reviewing"}.get(f.status.value, "open"),
        confidence=f.confidence if f.confidence is not None else 0.7,
        decisionNote=f.decision_note or "",
        decisionUpdatedAt=aware(f.decision_updated_at).isoformat() if f.decision_updated_at else None,
        recommendation=(ev.fix_text if ev else None) or rule.get("fix_template", ""),
        guideline=rule.get("official_definition", ""),
        observation=(ev.observation if ev else None),
        bbox=_primary_bbox(f, p_screen, screens_by_id),
        relatedElements=related,
        mitigated=f.mitigated,
        combinationRules=list(f.combination_with or []),
        combinationWith=[fid_of_rule[r] for r in (f.combination_with or []) if r in fid_of_rule],
        triggeredChecks=list(ev.triggered_checks or []) if ev else [],
        measurements=(ev.measurements if ev else None),
    )


def to_audit_dto(session: Session, audit: Audit, rules: dict) -> AuditDto:
    from .access import sign_image
    from . import jobs
    run = latest_completed_run(audit)

    screens_src = run.screens if run else (audit.runs[-1].screens if audit.runs else [])
    screens_by_id = {s.id: s for s in screens_src}
    screen_ext_id = {s.id: f"screen-{s.screen_index:02d}" for s in screens_src}

    findings: list[FindingDto] = []
    if run:
        # rule_id → findingId 매핑을 먼저 만든다 (combinationWith 용)
        fid_of_rule = {f.rule_id: f"finding-{f.id}" for f in run.findings}
        findings = [
            to_finding_dto(f, screens_by_id, screen_ext_id, rules, fid_of_rule)
            for f in run.findings
        ]
        findings = compat.filter_findings(findings)

    count_by_screen: dict[str, int] = {}
    for f in findings:
        for sid in f.screenIds:
            count_by_screen[sid] = count_by_screen.get(sid, 0) + 1

    screen_dtos = [
        ScreenDto(
            id=screen_ext_id[s.id],
            order=s.screen_index,
            flowStep=s.flow_step or f"화면 {s.screen_index}",
            imageUrl=sign_image(audit, s.image_path or ""),
            findingCount=count_by_screen.get(screen_ext_id[s.id], 0),
            width=s.viewport_w,
            height=s.viewport_h,
        )
        for s in sorted(screens_src, key=lambda x: x.screen_index)
    ]

    run_dtos = [
        AuditRunDto(
            id=f"run-{r.id}", version=r.version,
            status={"PENDING": "queued", "RUNNING": "analyzing",
                    "DONE": "completed", "FAILED": "failed"}[r.status.value],
            note=r.note, createdAt=aware(r.created_at), findingCount=len(r.findings),
        )
        for r in sorted(audit.runs, key=lambda x: x.version)
    ]

    status = "draft"
    if audit.runs:
        last = sorted(audit.runs, key=lambda x: x.version)[-1]
        status = {"PENDING": "queued", "RUNNING": "analyzing",
                  "DONE": "completed", "FAILED": "failed"}[last.status.value]

    return AuditDto(
        id=f"audit-{audit.id}",
        name=audit.name,
        platform=audit.product_name or "mobile-web",
        status=status,
        updatedAt=aware(audit.updated_at or audit.created_at),
        createdAt=aware(audit.created_at),
        productType=audit.sector if audit.sector in {"insurance", "deposit", "loan", "investment", "other"} else None,
        screens=screen_dtos,
        findings=findings,
        runs=run_dtos,
        latestRunId=f"run-{run.id}" if run else None,
        latestJobId=jobs.latest(DATA_DIR, f"audit-{audit.id}"),
        demoPreset=audit.demo_preset,
        demoVariant=(audit.runs[-1].analysis_summary or {}).get("demoVariant") if audit.runs else None,
        analysisSummary=(run.analysis_summary or {}) if run else (
            (audit.runs[-1].analysis_summary or {}) if audit.runs else {}
        ),
    )


def to_regression_dto(session: Session, report: RegressionReport) -> RegressionDto:
    """RegressionReport(계산 결과) → API 응답.

    findingId 는 실제로 조회 가능한 Finding 행을 가리켜야 하므로, resolved 는
    from run(더 이상 없는 쪽)에서, 나머지는 to run(현재 상태)에서 찾는다.
    """
    from_run = session.scalar(
        select(AuditRun).where(AuditRun.audit_id == report.audit_id, AuditRun.version == report.from_version)
    )
    to_run = session.scalar(
        select(AuditRun).where(AuditRun.audit_id == report.audit_id, AuditRun.version == report.to_version)
    )
    from_id_by_fp = {f.fingerprint: f.id for f in (from_run.findings if from_run else [])}
    to_id_by_fp = {f.fingerprint: f.id for f in (to_run.findings if to_run else [])}

    def change_dto(change, id_by_fp: dict[str, int], *, pending: bool = False) -> RegressionChangeDto:
        finding_id = id_by_fp.get(change.fingerprint)
        finding = session.get(Finding, finding_id) if finding_id is not None else None
        evidence = finding.evidence if finding else None
        note = None
        if pending:
            reasons = []
            for run in (from_run, to_run):
                for assessment in (run.analysis_summary or {}).get("ruleAssessments", []) if run else []:
                    if assessment.get("ruleId") == change.rule_id and assessment.get("status") in {"insufficient_evidence", "not_supported"}:
                        reasons.extend(f"v{run.version}: {reason}" for reason in assessment.get("reasons", []))
            note = " ".join(dict.fromkeys(reasons or report.limitations)) or None
        return RegressionChangeDto(
            ruleId=change.rule_id,
            findingId=f"finding-{finding_id}" if finding_id is not None else None,
            before=change.before.value if change.before else None,
            after=change.after.value if change.after else None,
            location=evidence.where_text if evidence else None,
            element=evidence.what_text if evidence else None,
            verificationNote=note,
        )

    return RegressionDto(
        auditId=f"audit-{report.audit_id}",
        fromVersion=report.from_version,
        toVersion=report.to_version,
        resolved=[change_dto(c, from_id_by_fp) for c in report.resolved],
        improved=[change_dto(c, to_id_by_fp) for c in report.improved],
        persisted=[change_dto(c, to_id_by_fp) for c in report.persisted],
        new=[change_dto(c, to_id_by_fp) for c in report.new],
        regressed=[change_dto(c, to_id_by_fp) for c in report.regressed],
        pending=[change_dto(c, from_id_by_fp, pending=True) for c in report.pending],
        limitations=report.limitations,
        comparisonStatus="incomplete" if report.limitations else "complete",
        resolvedRatio=round(report.resolved_ratio, 3) if report.resolved_ratio is not None else None,
        scopeDescription=("각 데모 단계에 처음 진입한 6개 화면끼리 비교합니다. 추가 클릭·스크롤은 탐색 기록에서 확인할 수 있습니다."
                          if all(run and (run.analysis_summary or {}).get("comparisonScope") == "demo-step-entry"
                                 for run in (from_run, to_run)) else None),
    )


def audit_pk(audit_id: str) -> int:
    """외부 id(audit-123) → 내부 PK."""
    try:
        if not re.fullmatch(r"audit-[1-9][0-9]*", audit_id):
            raise ValueError("Noncanonical audit ID")
        return int(audit_id.rsplit("-", 1)[-1])
    except ValueError as exc:
        raise KeyError(audit_id) from exc


def get_audit(session: Session, audit_id: str) -> Audit:
    a = session.get(Audit, audit_pk(audit_id))
    if a is None:
        raise KeyError(audit_id)
    return a


def list_audits(session: Session) -> list[Audit]:
    return list(session.scalars(select(Audit)
                               .order_by(Audit.updated_at.desc(), Audit.id.desc())))
