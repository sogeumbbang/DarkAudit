"""
Severity 계산
------------
Rule Base 의 severity_policy 를 적용해 최종 위험도를 산출한다.

가이드라인 원문이 일부 유형에 대해 "행위 자체로는 문제되지 않으나 다른 행위와
결합할 때 규제 가능"하다고 명시하므로, 유형 탐지와 위험도 판정을 분리해야 한다.

    standalone_sufficient = true   → 기본 HIGH
    standalone_sufficient = false  → 기본 REVIEW,
                                     combination_amplifiers 중 하나가
                                     같은 Flow 에서 함께 탐지되면 HIGH 로 승격
    mitigating_checks 충족          → 1단계 하향, mitigated 표시

DA-12(감정적 언어) · DA-13(감각조작) · DA-09(클릭 피로감) · DA-14(다른 소비자 활동
알림)가 standalone false 에 해당한다. 이 중 DA-12 · DA-13 은 MVP P0 이므로
결합 판정은 MVP 필수 기능이다.

계산 주체(Team A / Team B)는 협의 중이나, 로직 자체는 Rule Base 를 읽어야 하므로
규칙 데이터와 같은 쪽에 둔다. 이관이 필요하면 이 모듈만 옮기면 된다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .core import Detection, RuleBase

ORDER = ["LOW", "REVIEW", "HIGH"]


def downgrade(sev: str) -> str:
    i = ORDER.index(sev)
    return ORDER[max(0, i - 1)]


@dataclass
class ScoredFinding:
    rule_id: str
    label_unit: str
    screen_index: int | None
    primary_id: str | None
    related_ids: list[str] = field(default_factory=list)
    screen_indices: list[int] = field(default_factory=list)

    base_severity: str = "HIGH"
    severity: str = "HIGH"
    combination_with: list[str] = field(default_factory=list)
    mitigated: bool = False
    mitigated_by: list[str] = field(default_factory=list)

    triggered_checks: list[str] = field(default_factory=list)
    measurements: dict = field(default_factory=dict)

    def summary(self) -> str:
        loc = f"S{self.screen_index}" if self.screen_index else f"screens={self.screen_indices}"
        extra = ""
        if self.combination_with:
            extra = f"  ← {'+'.join(self.combination_with)} 결합"
        if self.mitigated:
            extra += "  (완화)"
        return f"{self.rule_id} {loc} {self.severity}{extra}"


def merge(detections: list[Detection], rb: RuleBase) -> list[ScoredFinding]:
    """
    같은 규칙·같은 요소에 여러 check 가 걸린 경우 하나의 Finding 으로 합친다.
    Rule Base 의 label_unit 에 따라 위치 정보를 다르게 담는다.
    """
    buckets: dict[tuple, ScoredFinding] = {}

    for d in detections:
        rule = rb.get(d.rule_id)
        unit = rule["label_unit"]
        # Evidence anchors must not split one screen/flow-level Rule finding.
        key = d.key if unit == "element" else (d.rule_id, d.screen_index, None)

        f = buckets.get(key)
        if f is None:
            f = ScoredFinding(
                rule_id=d.rule_id,
                label_unit=unit,
                screen_index=d.screen_index if unit == "element" else None,
                primary_id=d.primary.element_id if d.primary else None,
                screen_indices=d.screen_indices,
            )
            buckets[key] = f

        f.triggered_checks.append(d.check_id)
        f.measurements.update(d.measurements)
        for r in d.related:
            if r.element_id not in f.related_ids:
                f.related_ids.append(r.element_id)

    return list(buckets.values())


def score(findings: list[ScoredFinding], rb: RuleBase) -> list[ScoredFinding]:
    """severity_policy 를 적용한다."""
    present = {f.rule_id for f in findings}

    for f in findings:
        rule = rb.get(f.rule_id)

        if rule["standalone_sufficient"]:
            f.base_severity = f.severity = "HIGH"
        else:
            f.base_severity = "REVIEW"
            amps = [a for a in (rule.get("combination_amplifiers") or []) if a in present]
            if amps:
                f.severity = "HIGH"
                f.combination_with = sorted(amps)
            else:
                f.severity = "REVIEW"

        # 완화 요건은 별도 신호가 있을 때만 적용한다.
        # 현재는 탐지 단계에서 완화 여부를 판단하지 않으므로 자리만 마련해 둔다.
        if f.mitigated:
            f.severity = downgrade(f.severity)

    return findings


def drop_incomplete(findings: list[ScoredFinding], rb: RuleBase) -> list[ScoredFinding]:
    """
    related_required 인 규칙에서 상대 요소를 찾지 못한 탐지는 제외한다.

    DA-02 · DA-03 · DA-11 은 관계 자체가 위반 요건이므로, 한쪽만 찾은 결과는
    불완전한 탐지다. 그대로 내보내면 근거 없는 Finding 이 된다.
    """
    out = []
    for f in findings:
        if rb.get(f.rule_id)["related_required"] and not f.related_ids:
            continue
        out.append(f)
    return out
