"""Validate provider output and bind it to the original request."""
import logging
from typing import Any
from ai.schemas.audit_schema import (
    BASE_SEVERITY_MAP,
    RISK_NAME_MAP,
    RULE_BASE_SEVERITY,
    SEMANTIC_ONLY_RULE_IDS,
    HybridAuditOutput,
    LLMAuditOutput,
    LLMAuditRequest,
    RiskType,
    RuleCandidate,
)

LOGGER = logging.getLogger(__name__)

def parse_audit_response(raw: dict[str, Any], request: LLMAuditRequest) -> LLMAuditOutput:
    output = LLMAuditOutput.from_dict(raw)
    if output.audit_id != request.audit_id or output.schema_version != request.schema_version:
        raise ValueError("Response audit identity does not match request")
    expected = [(screen.screen_id, screen.flow_step) for screen in request.screens]
    actual = [(screen.screen_id, screen.flow_step) for screen in output.screens]
    if actual != expected: raise ValueError("Response screens do not match request order")
    return output


def drop_disallowed_semantic_findings(
    raw: dict[str, Any],
    allowed_semantic_rule_ids: frozenset[str],
) -> list[str]:
    """
    허용되지 않은 rule 의 semantic finding 을 버리고, 버린 rule_id 를 돌려준다.

    URL 캡처 경로에서는 deterministic 규칙을 Rule Engine 후보로만 다루므로 모델이
    그 규칙을 semantic_findings 에 직접 넣으면 안 된다. 다만 모델이 이를 어겼을 때
    실행 전체를 실패시키면, 나머지 정상 판정까지 함께 버려진다. 실제로 내용이 있는
    페이지에서 이 이유로 진단이 통째로 실패했다.

    스키마 불변식은 그대로 두고(계약은 계약이다) 모델 출력을 여기서 정제한다.
    조용히 지우면 모델 이상을 놓치므로 버린 항목은 호출부가 기록한다.
    """
    findings = raw.get("semantic_findings")
    if not isinstance(findings, list):
        return []
    kept, dropped = [], []
    for finding in findings:
        rule_id = finding.get("rule_id") if isinstance(finding, dict) else None
        # rule_id 가 없거나 형식이 틀린 항목은 스키마 검증이 판단하도록 남겨 둔다.
        if isinstance(rule_id, str) and rule_id not in allowed_semantic_rule_ids:
            dropped.append(rule_id)
        else:
            kept.append(finding)
    raw["semantic_findings"] = kept
    return dropped


def normalize_derived_labels(raw: dict[str, Any], candidates: list[RuleCandidate]) -> list[str]:
    """
    risk_type 과 rule_id 만으로 결정되는 값을 Rule Base 기준으로 덮어쓴다.

    severity 와 risk_name 은 모델의 판단이 아니라 조회표 값이다. 스펙도 severity 는
    Rule Base 의 base_severity 이고 최종 계산은 Rule Engine 책임이라고 못박고 있다.
    즉 모델 답변에는 정보가 없다. 그런데도 값이 다르면 스키마가 진단 전체를
    실패시켜서, 상수 하나 틀렸다고 정상 판정까지 통째로 버려졌다.

    되돌린 항목을 돌려주어 호출부가 기록할 수 있게 한다.
    """
    fixed: list[str] = []

    for finding in raw.get("semantic_findings") or []:
        if not isinstance(finding, dict):
            continue
        try:
            risk_type = RiskType(finding.get("risk_type"))
        except ValueError:
            continue  # 알 수 없는 risk_type 은 스키마 검증이 판단한다.
        for key, expected in (
            ("severity", BASE_SEVERITY_MAP[risk_type].value),
            ("risk_name", RISK_NAME_MAP[risk_type]),
        ):
            if finding.get(key) != expected:
                finding[key] = expected
                fixed.append(f"{finding.get('rule_id')}.{key}")

    rule_by_candidate = {candidate.candidate_id: candidate.rule_id for candidate in candidates}
    for decision in raw.get("candidate_decisions") or []:
        if not isinstance(decision, dict):
            continue
        rule_id = rule_by_candidate.get(decision.get("candidate_id"))
        if rule_id is None:
            continue
        expected = RULE_BASE_SEVERITY[rule_id].value
        if decision.get("base_severity") != expected:
            decision["base_severity"] = expected
            fixed.append(f"{rule_id}.base_severity")

    return fixed


def trim_single_screen_findings(raw: dict[str, Any]) -> list[str]:
    """
    단일 화면 규칙에 화면이 여러 개 달려 오면 근거 화면 하나로 줄인다.

    DA-15 를 뺀 나머지는 정의상 한 화면에서 판정한다. 그런데 모델이 여러 화면을
    나열하면 스키마가 "requires exactly one screen"으로 거부하고, 재시도 뒤 진단
    전체가 실패한다. 실제 배포에서 DA-07 이 이 이유로 죽었다.

    bbox 는 어차피 한 화면의 좌표이므로 화면 목록이 여러 개인 것은 모델의 서술
    실수에 가깝다.

    남길 화면은 related_elements 가 가장 많이 가리키는 쪽으로 고른다. DA-03 처럼
    대립 선택지 쌍이 근거인 규칙은 관련 요소가 살아남아야 판정이 성립하기 때문이다.
    관련 요소가 없으면 코드베이스 관례대로 마지막 화면을 쓴다. 그래도 다른 화면을
    가리키는 관련 요소는 참조가 끊기므로 함께 버린다.
    """
    trimmed: list[str] = []
    for finding in raw.get("semantic_findings") or []:
        if not isinstance(finding, dict):
            continue
        try:
            risk_type = RiskType(finding.get("risk_type"))
        except ValueError:
            continue  # 알 수 없는 risk_type 은 스키마 검증이 판단한다.
        if risk_type is RiskType.SEQUENTIAL_PRICE_DISCLOSURE:
            continue  # DA-15 만 여러 화면을 근거로 쓴다.
        where = finding.get("where")
        screen_ids = where.get("screen_ids") if isinstance(where, dict) else None
        if not isinstance(screen_ids, list) or len(screen_ids) <= 1:
            continue

        related = [r for r in (finding.get("related_elements") or []) if isinstance(r, dict)]
        counts = {sid: sum(r.get("screen_id") == sid for r in related) for sid in screen_ids}
        keep = max(screen_ids, key=lambda sid: (counts[sid], screen_ids.index(sid)))

        where["screen_ids"] = [keep]
        if related:
            finding["related_elements"] = [r for r in related if r.get("screen_id") == keep]
        trimmed.append(str(finding.get("rule_id")))
    return trimmed


def parse_hybrid_response(
    raw: dict[str, Any],
    request: LLMAuditRequest,
    candidates: list[RuleCandidate],
    allowed_semantic_rule_ids: frozenset[str] = SEMANTIC_ONLY_RULE_IDS,
) -> HybridAuditOutput:
    dropped = drop_disallowed_semantic_findings(raw, allowed_semantic_rule_ids)
    if dropped:
        LOGGER.warning(
            "dropped semantic findings not allowed for this audit source: %s",
            ", ".join(sorted(set(dropped))),
        )
    corrected = normalize_derived_labels(raw, candidates)
    if corrected:
        LOGGER.warning("corrected Rule Base derived fields: %s", ", ".join(sorted(set(corrected))))
    trimmed = trim_single_screen_findings(raw)
    if trimmed:
        LOGGER.warning(
            "trimmed multi-screen evidence on single-screen rules: %s",
            ", ".join(sorted(set(trimmed))),
        )
    output = HybridAuditOutput.from_dict(raw, candidates, allowed_semantic_rule_ids)
    if output.audit_id != request.audit_id or output.schema_version != request.schema_version:
        raise ValueError("Response audit identity does not match request")
    expected = [(screen.screen_id, screen.flow_step) for screen in request.screens]
    actual = [(screen.screen_id, screen.flow_step) for screen in output.screens]
    if actual != expected:
        raise ValueError("Response screens do not match request order")
    if "rule_assessments" in raw:
        from .assessment_contract import validate_assessments
        validate_assessments(raw["rule_assessments"], output, request)
    return output
