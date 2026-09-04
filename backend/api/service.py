"""Application service joining the HTTP API to the screenshot and URL AI pipelines."""

from __future__ import annotations

import os
import threading
from pathlib import Path

from sqlalchemy import select

from ai.browser.explorer import HybridWebExplorer
from ai.browser.models import CaptureArtifact, ScanMode
from ai.browser.playwright_driver import PlaywrightSessionFactory
from ai.pipeline.baseline import MVP_RULE_IDS, BaselineAuditPipeline
from ai.pipeline.web_audit import URLCapturePipeline, select_analysis_artifacts
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
from backend.app.rule_engine.core import Element as RuleElement
from backend.app.rule_engine.core import Flow as RuleFlow
from backend.app.rule_engine.core import RuleBase
from backend.app.rule_engine.core import Screen as RuleScreen
from backend.app.rule_engine.core import run as run_rule_engine
from backend.app.rule_engine.severity import ScoredFinding, drop_incomplete
from backend.app.rule_engine.severity import merge as merge_rule_detections
from backend.app.rule_engine.severity import score as score_rule_findings

from .schemas import JobDto
from .store import SessionLocal, new_id

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
CAPTURE_DIR = DATA_DIR / "captures"
FIGMA_DIR = DATA_DIR / "figma"

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
        request = LLMAuditRequest(
            f"audit-{run.audit_id}",
            tuple(
                AuditScreen(f"screen-{screen.screen_index:02d}", screen.flow_step or f"화면 {screen.screen_index}", path)
                for screen, path in zip(run.screens, local_paths, strict=True)
            ),
        )
        output = BaselineAuditPipeline(create_provider()).analyze(request)
        _update_job(job_id, progress=80)
        _store_output(session, run, output)
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
        selected = select_analysis_artifacts(capture.artifacts, 5)
        with SessionLocal() as session:
            run = session.get(AuditRun, run_id)
            if run is None:
                raise ValueError("Capture run no longer exists")
            screens: list[Screen] = []
            for index, artifact in enumerate(selected, 1):
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

            # URL 캡처만 DOM 을 갖고 있으므로 Rule Engine 은 이 경로에서만 돈다.
            element_lookup = _persist_dom_elements(session, screens, selected)
            rule_findings = _run_rule_engine(run.audit_id, screens, selected)

            request = LLMAuditRequest(
                audit_id,
                tuple(
                    AuditScreen(artifact.screen_id, artifact.flow_step, artifact.image_path)
                    for artifact in selected
                ),
            )
            candidates = _candidate_payload(rule_findings, screens, selected)
            pipeline = BaselineAuditPipeline(create_provider())
            analysis = pipeline.analyze(request, candidates)
            _update_job(job_id, progress=78)

            _store_output(
                session, run, analysis, rule_findings, element_lookup, candidates
            )
            _apply_regression(session, run)
            session.commit()
        _update_job(job_id, status="completed", progress=100)
    except Exception as exc:
        _fail_job(job_id, run_id, exc)


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
            session.commit()
    _update_job(job_id, status="failed", error=str(exc), progress=100)


def _build_rule_flow(
    audit_id: int, screens: list[Screen], artifacts: tuple[CaptureArtifact, ...]
) -> RuleFlow:
    rule_screens = [
        RuleScreen(
            screen.screen_index,
            [
                RuleElement(
                    element_id=element["element_id"],
                    element_type=element["element_type"],
                    text=element.get("text"),
                    bbox=element["bbox"],
                    state=element.get("state") or {},
                    style=element.get("computed_style") or {},
                )
                for element in getattr(artifact, "dom_elements", ())
            ],
        )
        for screen, artifact in zip(screens, artifacts, strict=True)
    ]
    return RuleFlow(flow_id=f"audit-{audit_id}", flow_type="join", sector=None, screens=rule_screens)


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
    rb = RuleBase()
    flow = _build_rule_flow(audit_id, screens, artifacts)
    detections = run_rule_engine(flow, rb, only=MVP_RULE_IDS)
    return score_rule_findings(drop_incomplete(merge_rule_detections(detections, rb), rb), rb)


def _candidate_payload(
    findings: list[ScoredFinding],
    screens: list[Screen],
    artifacts: tuple[CaptureArtifact, ...],
) -> list[dict]:
    """Make deterministic evidence explicit without presenting it as a verdict."""
    screen_ids = {
        screen.screen_index: artifact.screen_id
        for screen, artifact in zip(screens, artifacts, strict=True)
    }
    payload: list[dict] = []
    candidate_ids: set[str] = set()
    for finding in findings:
        indices = [finding.screen_index] if finding.screen_index is not None else list(finding.screen_indices)
        if not indices or indices[-1] not in screen_ids:
            raise ValueError(f"Rule candidate {finding.rule_id} has no captured screen")
        screen_index = indices[-1]
        screen_id = screen_ids[screen_index]
        anchor = finding.primary_id or "flow"
        candidate_id = f"{finding.rule_id}:{screen_id}:{anchor}"
        if candidate_id in candidate_ids:
            raise ValueError(f"duplicate generated candidate_id: {candidate_id}")
        candidate_ids.add(candidate_id)
        payload.append({
            "candidate_id": candidate_id,
            "rule_id": finding.rule_id,
            "screen_id": screen_id,
            "screen_index": screen_index,
            "primary_element_id": finding.primary_id,
            "related_element_ids": list(finding.related_ids),
            "triggered_checks": [
                check if check.startswith(f"{finding.rule_id}.") else f"{finding.rule_id}.{check}"
                for check in finding.triggered_checks
            ],
            "measurements": finding.measurements,
        })
    return payload


def _store_output(
    session,
    run: AuditRun,
    output: HybridAuditOutput,
    rule_findings: list[ScoredFinding] | None = None,
    element_lookup: dict[str, Element] | None = None,
    candidates: list[dict] | None = None,
) -> None:
    ordered_screens = sorted(run.screens, key=lambda screen: screen.screen_index)
    if len(ordered_screens) != len(output.screens):
        raise ValueError("분석 결과의 화면 수가 저장된 화면 수와 다릅니다.")
    screens = {
        reference.screen_id: screen
        for reference, screen in zip(output.screens, ordered_screens, strict=True)
    }
    rules = rules_by_id()
    element_lookup = element_lookup or {}
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
                source="vision",
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
        confidence = detection.confidence if detection is not None else decision.confidence

        finding = Finding(
            rule_id=matched.rule_id,
            label_unit=label_unit,
            fingerprint=make_fingerprint(
                matched.rule_id,
                screen_index=indices[0] if indices else None,
                text=element_text,
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

