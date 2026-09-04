"""Validate provider output and bind it to the original request."""
import logging
from typing import Any
from ai.schemas.audit_schema import (
    SEMANTIC_ONLY_RULE_IDS,
    HybridAuditOutput,
    LLMAuditOutput,
    LLMAuditRequest,
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
    output = HybridAuditOutput.from_dict(raw, candidates, allowed_semantic_rule_ids)
    if output.audit_id != request.audit_id or output.schema_version != request.schema_version:
        raise ValueError("Response audit identity does not match request")
    expected = [(screen.screen_id, screen.flow_step) for screen in request.screens]
    actual = [(screen.screen_id, screen.flow_step) for screen in output.screens]
    if actual != expected:
        raise ValueError("Response screens do not match request order")
    return output
