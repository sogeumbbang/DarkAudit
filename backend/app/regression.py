"""
Regression Audit
----------------
같은 Audit 의 두 회차를 비교해 위험이 실제로 해소됐는지 판정한다.

fingerprint 를 키로 양쪽 Finding 을 맞춰본다.

    이전에만 있음   → RESOLVED   (해소)
    양쪽에 있음     → OPEN       (미해결). severity 가 낮아졌으면 개선으로 별도 표시
    이번에만 있음   → OPEN       (신규). 이전에 RESOLVED 였다면 REGRESSED

REGRESSED 판정에는 v1 뿐 아니라 그 이전 회차 전체를 봐야 한다.
v1 에서 해결한 문제가 v3 에서 다시 나타나는 경우를 잡기 위해서다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditRun, Finding, FindingStatus, RunStatus, Screen, Severity

SEVERITY_ORDER = {Severity.LOW: 0, Severity.REVIEW: 1, Severity.HIGH: 2}
SCREEN_LOCAL_RULES = {"DA-03", "DA-04", "DA-07", "DA-12"}
LONG_FLOW_WARNING = "long_flow_comparison_limited"
SEMANTIC_DROP_WARNING = "semantic_findings_dropped"


@dataclass
class Change:
    fingerprint: str
    rule_id: str
    before: Severity | None = None
    after: Severity | None = None

    @property
    def improved(self) -> bool:
        if self.before is None or self.after is None:
            return False
        return SEVERITY_ORDER[self.after] < SEVERITY_ORDER[self.before]


@dataclass
class RegressionReport:
    audit_id: int
    from_version: int
    to_version: int

    resolved: list[Change] = field(default_factory=list)     # 해소됨
    persisted: list[Change] = field(default_factory=list)    # 남아 있음
    improved: list[Change] = field(default_factory=list)     # 남아 있으나 위험도 하락
    new: list[Change] = field(default_factory=list)          # 신규
    regressed: list[Change] = field(default_factory=list)    # 재발
    pending: list[Change] = field(default_factory=list)      # 재검증 근거 부족
    limitations: list[str] = field(default_factory=list)

    @property
    def resolved_ratio(self) -> float | None:
        """
        Resolved Finding Ratio — 기획서의 핵심 검증 지표.
        이전 회차 Finding 중 해소된 비율.

        보류(pending) 항목은 분모에서 뺀다. 제약이 있으면 다시 검증한 항목만으로
        계산하고, 검증한 항목이 하나도 없으면 산출하지 않는다.
        """
        total = len(self.resolved) + len(self.persisted) + len(self.improved)
        if self.limitations and not total:
            return None
        return len(self.resolved) / total if total else 0.0

    def summary(self) -> dict:
        return {
            "audit_id": self.audit_id,
            "from": f"v{self.from_version}",
            "to": f"v{self.to_version}",
            "resolved": len(self.resolved),
            "improved": len(self.improved),
            "persisted": len(self.persisted),
            "new": len(self.new),
            "regressed": len(self.regressed),
            "pending": len(self.pending),
            "limitations": self.limitations,
            "resolved_ratio": round(self.resolved_ratio, 3) if self.resolved_ratio is not None else None,
        }


def _findings(session: Session, run_id: int) -> dict[str, Finding]:
    rows = session.scalars(select(Finding).where(Finding.run_id == run_id)).all()
    return {f.fingerprint: f for f in rows}


def _previously_resolved(session: Session, audit_id: int, before_version: int) -> set[str]:
    """이전 회차들에서 비교 판정이나 담당자 표시로 한 번이라도 해결된 fingerprint."""
    runs = session.scalars(
        select(AuditRun).where(
            AuditRun.audit_id == audit_id, AuditRun.version < before_version
        )
    ).all()
    out: set[str] = set()
    for r in runs:
        for f in r.findings:
            if FindingStatus.RESOLVED in (f.comparison_status, f.status):
                out.add(f.fingerprint)
    return out


def _scope_limitations(previous: AuditRun, current: AuditRun) -> list[str]:
    """Collection failures and scope changes still block every rule."""
    limitations = []
    for run in (previous, current):
        summary = run.analysis_summary or {}
        if run.status != RunStatus.DONE:
            limitations.append(f"v{run.version}: 분석이 완료되지 않았습니다.")
        if not _analysis_screens(run) or summary.get("analyzedScreenCount") != len(_analysis_screens(run)):
            limitations.append(f"v{run.version}: 전체 화면의 분석 완료를 확인할 수 없습니다.")

    def screen_scope(run: AuditRun) -> list[tuple]:
        return [
            (screen.screen_index, screen.flow_type, screen.flow_step,
             (screen.analysis_context or {}).get("profile"),
             (screen.analysis_context or {}).get("path_id"))
            for screen in _analysis_screens(run)
        ]

    if screen_scope(previous) != screen_scope(current):
        limitations.append("두 회차의 화면 수·순서·단계 또는 탐색 경로가 달라 동일 범위의 재검증을 확인할 수 없습니다.")
    if set((previous.analysis_summary or {}).get("supportedRules", [])) != set(
        (current.analysis_summary or {}).get("supportedRules", [])
    ):
        limitations.append("두 회차의 지원 규칙이 달라 해결 여부를 확인할 수 없습니다.")
    return list(dict.fromkeys(limitations))


def _analysis_screens(run: AuditRun) -> list[Screen]:
    # A full-page source replaced by exhaustive readable crops is retained for
    # inspection, but is not an extra unexamined screen in the coverage count.
    return [screen for screen in run.screens
            if (screen.analysis_context or {}).get("analysis_included") is not False]


def _comparison_limitations(previous: AuditRun, current: AuditRun) -> list[str]:
    limitations = _scope_limitations(previous, current)
    for run in (previous, current):
        summary = run.analysis_summary or {}
        warnings = set(summary.get("warnings", []))
        if summary.get("complete") is not True or warnings:
            scoped = _rule_scoped_warnings(summary)
            if warnings == {LONG_FLOW_WARNING}:
                limitations.append(
                    f"v{run.version}: 분할 검사로 화면 간 가격 비교(DA-15)가 제한됩니다. "
                    "화면별 규칙은 해당 규칙의 전체 화면 검사 근거가 있을 때만 해결로 구분합니다."
                )
            elif warnings and warnings <= scoped.keys():
                rules = ", ".join(sorted(set().union(*(scoped[w] for w in warnings))))
                limitations.append(
                    f"v{run.version}: {rules} 판정 일부가 근거 기준을 충족하지 못해 "
                    "해당 규칙의 해결 여부만 보류합니다."
                )
            else:
                limitations.append(f"v{run.version}: 검사 미완료 또는 근거 부족으로 해결 여부를 확인할 수 없습니다.")
    return list(dict.fromkeys(limitations))


def _rule_scoped_warnings(summary: dict) -> dict[str, set[str]]:
    """Map warnings that concern only some rules to those rules.

    An evidence contract failure names its rule, and a bbox localization warning
    is recorded on one finding. Neither says anything about other rules, so
    they must not hold back an otherwise verified recheck of those rules.
    Dropped semantic findings likewise name their rules in telemetry; a batch
    that drops findings without naming them keeps the warning unscoped.
    """
    scoped: dict[str, set[str]] = {}
    unscoped: set[str] = set()
    for batch in summary.get("batches", []):
        telemetry = batch.get("telemetry", {})
        for warning in telemetry.get("warnings", []):
            if warning.startswith("evidence_contract:"):
                scoped.setdefault(warning, set()).add(warning.split(":", 1)[1])
            elif warning == SEMANTIC_DROP_WARNING:
                if dropped := telemetry.get("dropped_semantic_rule_ids"):
                    scoped.setdefault(warning, set()).update(dropped)
                else:
                    unscoped.add(warning)
        for item in telemetry.get("bbox_localizations", []):
            if item.get("warning") and item.get("rule_id"):
                scoped.setdefault(item["warning"], set()).add(item["rule_id"])
    for warning in summary.get("warnings", []):
        if warning.startswith("evidence_contract:"):
            scoped.setdefault(warning, set()).add(warning.split(":", 1)[1])
    for warning in unscoped:
        scoped.pop(warning, None)
    return scoped


def _blocks_rule(warning: str, rule_id: str, scoped: dict[str, set[str]]) -> bool:
    if warning == LONG_FLOW_WARNING:
        return rule_id not in SCREEN_LOCAL_RULES
    return rule_id in scoped.get(warning, {rule_id})


def _verified_rule(run: AuditRun, rule_id: str) -> bool:
    """Verify each rule independently when collection and scope are intact.

    Require explicit assessment coverage for every stored screen, including
    overlapping batches. A clean batch must never mask missing evidence in another.
    A different rule being inconclusive does not invalidate this rule.
    Price comparisons remain conservative when a journey was split across batches.
    """
    summary = run.analysis_summary or {}
    warnings = set(summary.get("warnings", []))
    scoped = _rule_scoped_warnings(summary)
    if any(_blocks_rule(warning, rule_id, scoped) for warning in warnings):
        return False
    if summary.get("complete") is not True and not warnings and not any(
        assessment.get("status") in {"insufficient_evidence", "not_supported"}
        for batch in summary.get("batches", [])
        for assessment in batch.get("telemetry", {}).get("rule_assessments", [])
    ):
        # An unexplained incomplete run is not a rule-specific limitation.
        return False
    if rule_id not in summary.get("supportedRules", []):
        return False
    expected = {(screen.analysis_context or {}).get("analysis_screen_id", f"screen-{screen.screen_index:02d}")
                for screen in _analysis_screens(run)}
    if rule_id == "DA-15" and not any(
        set(batch.get("screens", [])) == expected for batch in summary.get("batches", [])
    ):
        return False
    covered = set()
    for batch in summary.get("batches", []):
        screens = set(batch.get("screens", []))
        telemetry = batch.get("telemetry", {})
        if not screens or not screens <= expected or any(
            _blocks_rule(warning, rule_id, scoped) for warning in telemetry.get("warnings", [])
        ):
            return False
        provider = str(telemetry.get("provider") or "")
        if not provider or "fake" in provider.lower():
            return False
        assessments = [a for a in telemetry.get("rule_assessments", []) if a.get("rule_id") == rule_id]
        if len(assessments) != 1:
            return False
        assessment = assessments[0]
        if assessment.get("status") not in {"detected", "not_detected"}:
            return False
        if set(assessment.get("screen_ids", [])) != screens:
            return False
        covered.update(screens)
    return bool(expected) and covered == expected


def compare(
    session: Session, audit_id: int, from_version: int, to_version: int,
    *, update_statuses: bool = False,
) -> RegressionReport:
    if from_version > to_version:
        raise ValueError("이전 회차는 이후 회차보다 클 수 없습니다.")
    prev_run = session.scalar(
        select(AuditRun).where(
            AuditRun.audit_id == audit_id, AuditRun.version == from_version
        )
    )
    curr_run = session.scalar(
        select(AuditRun).where(
            AuditRun.audit_id == audit_id, AuditRun.version == to_version
        )
    )
    if prev_run is None or curr_run is None:
        raise ValueError(f"회차를 찾을 수 없다: v{from_version} 또는 v{to_version}")

    prev = _findings(session, prev_run.id)
    curr = _findings(session, curr_run.id)
    ever_resolved = _previously_resolved(session, audit_id, to_version)

    report = RegressionReport(audit_id, from_version, to_version)
    report.limitations = _comparison_limitations(prev_run, curr_run)
    same_scope = not _scope_limitations(prev_run, curr_run)

    def can_verify(rule_id: str) -> bool:
        return not report.limitations or (
            same_scope
            and _verified_rule(prev_run, rule_id)
            and _verified_rule(curr_run, rule_id)
        )

    for fp, pf in prev.items():
        if fp in curr:
            cf = curr[fp]
            ch = Change(fp, pf.rule_id, pf.severity, cf.severity)
            (report.improved if ch.improved else report.persisted).append(ch)
        else:
            target = report.resolved if can_verify(pf.rule_id) else report.pending
            target.append(Change(fp, pf.rule_id, before=pf.severity))

    for fp, cf in curr.items():
        if fp in prev:
            continue
        ch = Change(fp, cf.rule_id, after=cf.severity)
        if fp in ever_resolved:
            report.regressed.append(ch)
            if update_statuses and can_verify(cf.rule_id):
                cf.comparison_status = FindingStatus.REGRESSED
        else:
            report.new.append(ch)

    # 이전 회차 Finding 의 비교 판정을 남긴다.
    # 다음 비교에서 재발 여부를 판단하려면 이 기록이 남아 있어야 한다.
    # 담당자가 표시한 status 는 그 회차의 기록이라 건드리지 않는다.
    if update_statuses:
        resolved_fps = {c.fingerprint for c in report.resolved}
        for fp, pf in prev.items():
            if fp in resolved_fps:
                pf.comparison_status = FindingStatus.RESOLVED
            elif can_verify(pf.rule_id):
                pf.comparison_status = FindingStatus.OPEN

        session.flush()
    return report
