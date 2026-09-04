"""Validate provider output and bind it to the original request."""
from typing import Any
from ai.schemas.audit_schema import (
    SEMANTIC_ONLY_RULE_IDS,
    HybridAuditOutput,
    LLMAuditOutput,
    LLMAuditRequest,
    RuleCandidate,
)

def parse_audit_response(raw: dict[str, Any], request: LLMAuditRequest) -> LLMAuditOutput:
    output = LLMAuditOutput.from_dict(raw)
    if output.audit_id != request.audit_id or output.schema_version != request.schema_version:
        raise ValueError("Response audit identity does not match request")
    expected = [(screen.screen_id, screen.flow_step) for screen in request.screens]
    actual = [(screen.screen_id, screen.flow_step) for screen in output.screens]
    if actual != expected: raise ValueError("Response screens do not match request order")
    return output


def parse_hybrid_response(
    raw: dict[str, Any],
    request: LLMAuditRequest,
    candidates: list[RuleCandidate],
    allowed_semantic_rule_ids: frozenset[str] = SEMANTIC_ONLY_RULE_IDS,
) -> HybridAuditOutput:
    output = HybridAuditOutput.from_dict(raw, candidates, allowed_semantic_rule_ids)
    if output.audit_id != request.audit_id or output.schema_version != request.schema_version:
        raise ValueError("Response audit identity does not match request")
    expected = [(screen.screen_id, screen.flow_step) for screen in request.screens]
    actual = [(screen.screen_id, screen.flow_step) for screen in output.screens]
    if actual != expected:
        raise ValueError("Response screens do not match request order")
    return output
