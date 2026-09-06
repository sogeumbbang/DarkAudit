"""Application service joining the HTTP API to the screenshot and URL AI pipelines."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import select

from ai.browser.explorer import HybridWebExplorer
from ai.browser.models import CaptureArtifact, ScanMode
from ai.browser.playwright_driver import PlaywrightSessionFactory
from ai.pipeline.baseline import MVP_RULE_IDS, BaselineAuditPipeline
from ai.pipeline.web_audit import URLCapturePipeline, prepare_analysis_artifacts, analysis_batches, batch_indices
from ai.pipeline.rule_candidates import run_artifact_rules, candidate_payload
from ai.pipeline.quality import summarize
from ai.providers import create_provider
from ai.providers.computer_use import OpenAIComputerUseAgent
from ai.rules.rule_loader import RuleLoader
from ai.schemas.audit_schema import (
    AuditScreen,
    CandidateDecisionValue,
    HybridAuditOutput,
    LLMAuditRequest,
)
from backend.app.fingerprint import make as make_fingerprint
from backend.app.models import (
    AuditRun,
    Element,
    Evidence,
    Finding,
    FindingRelatedElement,
    FindingStatus,
    FlowType,
    RunStatus,
    Screen,
    Severity,
)
from backend.app.regression import compare
from backend.app.rule_engine import checks as _rule_engine_checks  # noqa: F401  — 데코레이터 등록을 위해 필요
from backend.app.rule_engine.core import RuleBase
from backend.app.rule_engine.severity import ScoredFinding
from backend.app.rule_engine.severity import score as score_rule_findings

from .schemas import JobDto
from .store import SessionLocal, new_id

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
CAPTURE_DIR = DATA_DIR / "captures"
FIGMA_DIR = DATA_DIR / "figma"
ANDROID_DIR = DATA_DIR / "android"

_jobs: dict[str, JobDto] = {}
_jobs_lock = threading.Lock()


def rules_by_id() -> dict[str, dict]:
    return {rule["rule_id"]: rule for rule in RuleLoader().rules()}


def create_job(audit_id: str, run_id: int) -> JobDto:
    job = JobDto(
        jobId=new_id("job"), auditId=audit_id, runId=f"run-{run_id}",
        status="queued", progress=5,
    )
    with _jobs_lock:
        _jobs[job.jobId] = job
    return job


def get_job(job_id: str) -> JobDto:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job.model_copy(deep=True)


def recover_interrupted_runs() -> int:
    """Fail runs whose in-memory workers disappeared during a server restart."""
    with SessionLocal() as session:
        runs = session.scalars(
            select(AuditRun).where(
                AuditRun.status.in_((RunStatus.PENDING, RunStatus.RUNNING))
            )
        ).all()
        for run in runs:
            run.status = RunStatus.FAILED
            run.note = "서버 재시작으로 진단 작업이 중단되었습니다. 다시 진단해 주세요."
        session.commit()
        return len(runs)


def compatible_capture_profiles(url: str, profiles: tuple[str, ...]) -> tuple[str, ...]:
    """Avoid loading an explicitly mobile URL with a desktop user agent."""
    path = urlsplit(url).path.rstrip("/").lower()
    is_mobile_path = path == "/m" or path.startswith("/m/")
    if not is_mobile_path:
        return profiles
    if "mobile" not in profiles:
        raise ValueError("/m/ 모바일 전용 URL은 모바일 화면을 선택해 주세요.")
    return tuple(profile for profile in profiles if profile != "desktop")


def _update_job(job_id: str, **changes: object) -> None:
    with _jobs_lock:
        job = _jobs[job_id]
        for key, value in changes.items():
            setattr(job, key, value)


def next_run(session, audit_id: int, note: str | None = None) -> AuditRun:
    latest = session.scalar(
        select(AuditRun.version)
        .where(AuditRun.audit_id == audit_id)
        .order_by(AuditRun.version.desc())
        .limit(1)
    )
    run = AuditRun(audit_id=audit_id, version=(latest or 0) + 1, status=RunStatus.PENDING, note=note)
    session.add(run)
    session.flush()
    return run


def public_image_path(path: Path) -> str:
    resolved = path.resolve()
    relative = resolved.relative_to(DATA_DIR.resolve())
    return "/artifacts/" + relative.as_posix()


def analyze_uploaded_screens(job_id: str, run_id: int, local_paths: list[Path]) -> None:
    try:
        _mark_running(job_id, run_id, 20)
        analyze_run_screens(job_id, run_id, local_paths)
    except Exception as exc:  # background jobs must expose failures to the polling client
        _fail_job(job_id, run_id, exc)


def analyze_run_screens(job_id: str, run_id: int, local_paths: list[Path]) -> None:
    """LLM 분석 + DB 저장. 업로드/Figma 등 모든 수집기가 이 함수를 공유한다.

    수집기별로 진행률 갱신(_mark_running)을 먼저 마친 뒤 호출해야 하며,
    예외 처리는 호출부 책임이다(각 수집기가 자기 맥락으로 _fail_job 을 부른다).
    """
    with SessionLocal() as session:
        run = session.get(AuditRun, run_id)
        if run is None:
            raise ValueError("Analysis run no longer exists")
        ordered = list(zip(run.screens, local_paths, strict=True))
        groups = (run.analysis_summary or {}).get("paths") or [[s.screen_index for s, _ in ordered]]
        lookup = {s.screen_index: (s, p) for s, p in ordered}
        for group in groups:
            if len(group) > 5:
                run.analysis_summary = {**(run.analysis_summary or {}), "warnings": [
                    *(run.analysis_summary or {}).get("warnings", []), "long_flow_comparison_limited"]}
            for positions in batch_indices(len(group)):
                indices = [group[i] for i in positions]
                batch = [lookup[index] for index in indices if index in lookup]
                if not batch:
                    continue
                request = LLMAuditRequest(f"audit-{run.audit_id}", tuple(
                    _audit_screen(s, p) for s, p in batch
                ))
                pipeline = BaselineAuditPipeline(create_provider(), allow_visual_fallback=True)
                output = pipeline.analyze(request)
                _record_analysis(run, pipeline, request)
                grounded_visuals = {
                    (item["rule_id"], item["screen_id"])
                    for item in pipeline.last_run_telemetry.get("bbox_localizations", [])
                    if item.get("applied") is True
                }
                _update_job(job_id, progress=80)
                _store_output(session, run, output, grounded_visuals=grounded_visuals,
                              analysis_screens=[s for s, _ in batch])
        _apply_regression(session, run)
        session.commit()
    _update_job(job_id, status="completed", progress=100)


def capture_and_analyze_url(
    job_id: str,
    run_id: int,
    *,
    audit_id: str,
    url: str,
    profiles: tuple[str, ...],
    mode: ScanMode,
    goal: str | None,
) -> None:
    try:
        _mark_running(job_id, run_id, 12)
        computer_agent = None
        if mode is ScanMode.SMART:
            computer_agent = OpenAIComputerUseAgent(os.environ["DARKAUDIT_COMPUTER_MODEL"])
        explorer = HybridWebExplorer(
            PlaywrightSessionFactory(CAPTURE_DIR), computer_agent=computer_agent
        )
        capture = URLCapturePipeline(explorer).run(
            audit_id=audit_id, url=url, profiles=profiles, mode=mode, goal=goal
        )
        selected = prepare_analysis_artifacts(capture.artifacts)
        persisted = list(capture.artifacts)
        persisted_paths = {artifact.image_path.resolve() for artifact in persisted}
        for artifact in selected:
            if artifact.image_path.resolve() not in persisted_paths:
                persisted.append(artifact)
                persisted_paths.add(artifact.image_path.resolve())
        with SessionLocal() as session:
            run = session.get(AuditRun, run_id)
            if run is None:
                raise ValueError("Capture run no longer exists")
            screens: list[Screen] = []
            screen_by_path: dict[Path, Screen] = {}
            for index, artifact in enumerate(persisted, 1):
                screen = Screen(
                    flow_type=FlowType.join,
                    screen_index=index,
                    flow_step=artifact.flow_step,
                    image_path=public_image_path(artifact.image_path),
                    viewport_w=artifact.viewport_width,
                    viewport_h=artifact.viewport_height,
                )
                run.screens.append(screen)
                screens.append(screen)
                screen_by_path[artifact.image_path.resolve()] = screen

            analysis_screens = [
                screen_by_path[artifact.image_path.resolve()] for artifact in selected
            ]

            # URL 캡처만 DOM 을 갖고 있으므로 Rule Engine 은 이 경로에서만 돈다.
            element_lookup = _persist_dom_elements(session, analysis_screens, selected)
            # Capture is useful on its own and must survive an optional AI failure.
            # Without this commit, a missing/invalid model setting rolled the screenshots
            # back together with the analysis transaction, leaving the UI with no evidence.
            session.commit()
            run.analysis_summary = {"source": "url", "warnings": [
                f"{p.profile}: {p.stop_reason}" for p in capture.profiles
                if p.stop_reason != "Computer Use completed exploration"
            ]}
            if any(sum(a.profile == b.profile and a.path_id == b.path_id for b in selected) > 5 for a in selected):
                run.analysis_summary = {**run.analysis_summary, "warnings": [
                    *run.analysis_summary["warnings"], "long_flow_comparison_limited"]}
            for batch in analysis_batches(selected):
                batch_screens = [screen_by_path[a.image_path.resolve()] for a in batch]
                rule_findings = _run_rule_engine(run.audit_id, batch_screens, batch)
                request = LLMAuditRequest(audit_id, tuple(
                    AuditScreen(a.screen_id, a.flow_step, a.image_path, a.profile,
                                a.path_id, a.state_id or a.screen_id, a.dom_elements) for a in batch
                ))
                candidates = _candidate_payload(rule_findings, batch_screens, batch)
                # A missing DOM falls back to explicit visual checks, with the
                # evidence limitation preserved in the result.
                pipeline = BaselineAuditPipeline(create_provider(), allow_visual_fallback=any(not a.dom_elements for a in batch))
                analysis = pipeline.analyze(request, candidates)
                _record_analysis(run, pipeline, request, [w for a in batch for w in a.warnings])
                _update_job(job_id, progress=78)
                grounded = {(item["rule_id"], item["screen_id"])
                            for item in pipeline.last_run_telemetry.get("bbox_localizations", []) if item.get("applied")}
                _store_output(session, run, analysis, rule_findings, element_lookup, candidates,
                              analysis_screens=batch_screens, grounded_visuals=grounded)
            _apply_regression(session, run)
            session.commit()
        _update_job(job_id, status="completed", progress=100)
    except Exception as exc:
        _fail_job(job_id, run_id, exc)


def _audit_screen(screen: Screen, path: Path) -> AuditScreen:
    context = screen.analysis_context or {}
    return AuditScreen(f"screen-{screen.screen_index:02d}", screen.flow_step or f"화면 {screen.screen_index}",
                       path, context.get("profile", "unspecified"), context.get("path_id", "main"),
                       context.get("state_id", str(screen.screen_index)), tuple(context.get("evidence", [])))


def _record_analysis(run: AuditRun, pipeline: BaselineAuditPipeline, request: LLMAuditRequest,
                     warnings: list[str] | None = None) -> None:
    summary = dict(run.analysis_summary or {})
    telemetry = pipeline.last_run_telemetry
    all_warnings = list(summary.get("warnings", [])) + (warnings or [])
    all_warnings.extend(item["warning"] for item in telemetry.get("bbox_localizations", []) if item.get("warning"))
    all_warnings.extend(telemetry.get("warnings", []))
    summary["warnings"] = sorted(set(all_warnings))
    summary["supportedRules"] = sorted(MVP_RULE_IDS)
    summary["batches"] = [*summary.get("batches", []), {
        "screens": [s.screen_id for s in request.screens], "telemetry": telemetry,
    }]
    run.analysis_summary = summarize(summary)


def _mark_running(job_id: str, run_id: int, progress: float) -> None:
    with SessionLocal() as session:
        run = session.get(AuditRun, run_id)
        if run is None:
            raise ValueError("Analysis run no longer exists")
        run.status = RunStatus.RUNNING
        session.commit()
    _update_job(job_id, status="analyzing", progress=progress)


def _fail_job(job_id: str, run_id: int, exc: Exception) -> None:
    with SessionLocal() as session:
        run = session.get(AuditRun, run_id)
        if run is not None:
            run.status = RunStatus.FAILED
            run.note = str(exc)[:1000]
            run.analysis_summary = summarize({**(run.analysis_summary or {}), "warnings":
                [*(run.analysis_summary or {}).get("warnings", []), "analysis_failed"]})
            session.commit()
    _update_job(job_id, status="failed", error=str(exc), progress=100)


def _persist_dom_elements(
    session, screens: list[Screen], artifacts: tuple[CaptureArtifact, ...]
) -> dict[str, Element]:
    """캡처된 DOM 요소를 전부 저장한다 (models.py 설계 결정 #2).

    Finding 에 걸리지 않은 요소도 남겨야 임계값을 조정했을 때 재계산만으로
    결과를 갱신할 수 있다.
    """
    lookup: dict[str, Element] = {}
    for screen, artifact in zip(screens, artifacts, strict=True):
        for element in getattr(artifact, "dom_elements", ()):
            x, y, w, h = element["bbox"]
            row = Element(
                screen=screen,
                dom_id=element["element_id"],
                element_type=element.get("element_type"),
                text=element.get("text"),
                bbox_x=x, bbox_y=y, bbox_w=w, bbox_h=h,
                state=element.get("state") or {},
                computed_style=element.get("computed_style") or {},
                source="dom",
            )
            session.add(row)
            lookup[element["element_id"]] = row
    session.flush()
    return lookup


def _run_rule_engine(
    audit_id: int, screens: list[Screen], artifacts: tuple[CaptureArtifact, ...]
) -> list[ScoredFinding]:
    return run_artifact_rules(str(audit_id), [s.screen_index for s in screens], artifacts)


def _candidate_payload(
    findings: list[ScoredFinding],
    screens: list[Screen],
    artifacts: tuple[CaptureArtifact, ...],
) -> list[dict]:
    return candidate_payload(findings, [s.screen_index for s in screens], artifacts)


def _same_primary(first: Element | None, second: Element | None) -> bool:
    if first is None or second is None or first.screen_id != second.screen_id:
        return False
    if first.id == second.id:
        return True
    width = max(0, min(first.bbox_x + first.bbox_w, second.bbox_x + second.bbox_w)
                - max(first.bbox_x, second.bbox_x))
    height = max(0, min(first.bbox_y + first.bbox_h, second.bbox_y + second.bbox_h)
                 - max(first.bbox_y, second.bbox_y))
    intersection = width * height
    union = first.bbox_w * first.bbox_h + second.bbox_w * second.bbox_h - intersection
    return union > 0 and intersection / union >= 0.7


def _store_output(
    session,
    run: AuditRun,
    output: HybridAuditOutput,
    rule_findings: list[ScoredFinding] | None = None,
    element_lookup: dict[str, Element] | None = None,
    candidates: list[dict] | None = None,
    grounded_visuals: set[tuple[str, str]] | None = None,
    analysis_screens: list[Screen] | None = None,
) -> None:
    ordered_screens = analysis_screens or sorted(
        run.screens, key=lambda screen: screen.screen_index
    )
    if len(ordered_screens) != len(output.screens):
        raise ValueError("분석 결과의 화면 수가 저장된 화면 수와 다릅니다.")
    screens = {
        reference.screen_id: screen
        for reference, screen in zip(output.screens, ordered_screens, strict=True)
    }
    rules = rules_by_id()
    element_lookup = element_lookup or {}
    grounded_visuals = grounded_visuals or set()
    # Candidate IDs are the only join key; Rule/screen inference is forbidden.
    rule_findings = rule_findings or []
    candidates = candidates or []
    if len(rule_findings) != len(candidates):
        raise ValueError("Rule findings and candidate payload counts do not match")
    candidate_pool = {
        payload["candidate_id"]: (payload, finding)
        for payload, finding in zip(candidates, rule_findings, strict=True)
    }
    if len(candidate_pool) != len(candidates):
        raise ValueError("candidate_id values must be unique")

    verified: list[dict] = []
    for decision in output.candidate_decisions:
        pair = candidate_pool.get(decision.candidate_id)
        if pair is None:
            raise ValueError(f"unknown candidate_id: {decision.candidate_id}")
        if decision.decision is CandidateDecisionValue.REJECT:
            continue
        payload, matched = pair
        indices = [matched.screen_index] if matched.screen_index is not None else list(matched.screen_indices)
        verified.append({
            "detection": None,
            "decision": decision,
            "referenced": [screens[payload["screen_id"]]],
            "indices": indices,
            "matched": matched,
        })

    for detection in output.semantic_findings:
        referenced = [screens[screen_id] for screen_id in detection.where.screen_ids]
        indices = [screen.screen_index for screen in referenced]
        matched = ScoredFinding(
            rule_id=detection.rule_id,
            label_unit=rules[detection.rule_id]["label_unit"],
            screen_index=indices[0] if len(indices) == 1 else None,
            primary_id=None,
            screen_indices=indices if len(indices) > 1 else [],
        )
        verified.append({
            "detection": detection,
            "decision": None,
            "referenced": referenced,
            "indices": indices,
            "matched": matched,
        })

    # Recompute final severity using only KEEP candidates and semantic findings.
    for item in verified:
        item["matched"].combination_with = []
    score_rule_findings([item["matched"] for item in verified], RuleBase())

    for item in verified:
        detection = item["detection"]
        decision = item["decision"]
        referenced = item["referenced"]
        indices = item["indices"]
        matched = item["matched"]
        label_unit = matched.label_unit

        primary = element_lookup.get(matched.primary_id) if matched.primary_id else None
        if primary is None and detection is not None:
            x, y, width, height = detection.bbox
            evidence_screen_id = detection.where.screen_ids[-1]
            primary = Element(
                # Semantic bbox is an evidence anchor even for flow-level rules.
                # Multi-screen contracts (DA-15) place it on the final screen.
                screen=referenced[-1],
                element_type="vision",
                text=detection.where.element,
                bbox_x=x,
                bbox_y=y,
                bbox_w=width,
                bbox_h=height,
                source=(
                    "vision-grounded"
                    if (detection.rule_id, evidence_screen_id) in grounded_visuals
                    else "vision"
                ),
                confidence=detection.confidence,
            )
            session.add(primary)
            session.flush()

        rule = rules[matched.rule_id]
        element_text = (
            detection.where.element
            if detection is not None
            else (primary.text if primary is not None else matched.primary_id or matched.rule_id)
        )

        # 회차 비교용 지문의 재료.
        #
        # 모델이 쓴 요소 서술(detection.where.element)은 같은 화면을 다시 분석해도
        # 표현이 달라진다. 그걸 지문에 넣으면 고친 게 없는데도 "기존 문제 해결 +
        # 새 문제 발생"으로 잡힌다. 실제로 같은 입력을 두 번 돌렸을 때 매칭이
        # 하나도 되지 않았다.
        #
        # 그래서 DOM 에서 온 텍스트만 지문에 쓰고, 모델 서술뿐인 경우에는 위치로
        # 식별한다. 평가기(ai/evaluation)가 정답과 대조할 때 쓰는 기준과 같다.
        #
        # DOM 요소가 없으면 위에서 모델 서술을 text 로 담은 Element 를 만든다.
        # 그것까지 쓰면 원래 문제로 돌아가므로 source 로 걸러낸다.
        stable_text = (
            primary.text if primary is not None and primary.source == "dom" else None
        )
        stable_bbox = (
            primary.bbox
            if primary is not None
            else (list(detection.bbox) if detection is not None else None)
        )
        confidence = detection.confidence if detection is not None else decision.confidence

        if any(existing.rule_id == matched.rule_id
               and existing.screen_indices == indices
               and _same_primary(existing.primary_element, primary)
               for existing in run.findings):
            continue

        finding = Finding(
            rule_id=matched.rule_id,
            label_unit=label_unit,
            fingerprint=make_fingerprint(
                matched.rule_id,
                screen_index=indices[0] if indices else None,
                bbox=stable_bbox,
                text=stable_text,
                label_unit=label_unit,
            ),
            primary_element=primary,
            screen_indices=indices,
            base_severity=Severity(matched.base_severity),
            severity=Severity(matched.severity),
            combination_with=list(matched.combination_with),
            mitigated_by=list(matched.mitigated_by),
            mitigated=matched.mitigated,
            status=FindingStatus.OPEN,
            confidence=confidence,
        )
        finding.evidence = Evidence(
            where_text=detection.where.location if detection is not None else referenced[0].flow_step,
            what_text=detection.what if detection is not None else element_text,
            observation=detection.observation if detection is not None else decision.reason,
            rule_ref=matched.rule_id,
            why_text=detection.why if detection is not None else decision.reason,
            fix_text=detection.fix if detection is not None else rule.get("fix_template", ""),
            triggered_checks=list(matched.triggered_checks),
            measurements=matched.measurements or None,
        )
        for related_id in matched.related_ids:
            related_element = element_lookup.get(related_id)
            if related_element is not None:
                finding.related.append(FindingRelatedElement(element=related_element))
        if detection is not None:
            for related in detection.related_elements:
                related_screen = screens[related.screen_id]
                x, y, width, height = related.bbox
                related_element = Element(
                    screen=related_screen,
                    element_type="vision",
                    text=related.element,
                    bbox_x=x,
                    bbox_y=y,
                    bbox_w=width,
                    bbox_h=height,
                    source="vision",
                    confidence=detection.confidence,
                )
                session.add(related_element)
                finding.related.append(FindingRelatedElement(element=related_element))
        run.findings.append(finding)

    run.status = RunStatus.DONE


def _apply_regression(session, run: AuditRun) -> None:
    previous = session.scalar(
        select(AuditRun)
        .where(
            AuditRun.audit_id == run.audit_id,
            AuditRun.version < run.version,
            AuditRun.status == RunStatus.DONE,
        )
        .order_by(AuditRun.version.desc())
    )
    if previous is not None:
        compare(session, run.audit_id, previous.version, run.version)
