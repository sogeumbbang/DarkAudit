"""Rule coverage and evidence validation beyond syntactic JSON validity."""

import math
import re

from ai.schemas.audit_schema import RULE_BASE_SEVERITY

CHECKS = {
    "DA-03": {"visual_hierarchy", "optional_looks_mandatory"},
    "DA-04": {
        "selected_paid_option",
        "default_checked",
        "default_affirmative_answer",
        "optional_consent_prechecked",
        "premium_option_default",
    },
    "DA-07": {
        "small_important_text",
        "low_contrast_important_text",
        "hidden_important_details",
    },
    "DA-12": {"loss_framed_decline", "trivializing_expression"},
    "DA-15": {"late_mandatory_cost", "rate_deterioration"},
}
STATUSES = {"detected", "not_detected", "insufficient_evidence", "not_supported"}


class EvidenceContractError(ValueError):
    def __init__(self, rule_id: str, message: str):
        self.rule_id = rule_id
        super().__init__(message)


def _label_matches(label: str, description: str) -> bool:
    # The UI label may be embedded in a description such as “X 버튼”.
    normalized = lambda value: re.sub(r"[^\w]", "", value.casefold())
    return bool(normalized(label)) and normalized(label) in normalized(description)


def _valid_pair_role(pair, checks):
    kind = pair.get("pair_kind", "opposing_choices")
    return (kind == "opposing_choices" and pair.get("decline_is_action") is True) or (
        kind == "optional_as_required" and "optional_looks_mandatory" in checks
    )


def validate_assessments(assessments, output, request):
    if not isinstance(assessments, list):
        raise ValueError("rule_assessments must be an array")
    rules = [a.get("rule_id") for a in assessments if isinstance(a, dict)]
    if len(rules) != len(RULE_BASE_SEVERITY) or set(rules) != set(RULE_BASE_SEVERITY):
        raise ValueError(
            "Return exactly one rule_assessment for each of the five MVP rules"
        )
    screens = {s.screen_id: s for s in request.screens}
    order = {s.screen_id: i for i, s in enumerate(request.screens)}
    candidates = {c.candidate_id: c for c in output.candidates}
    kept = [
        candidates[d.candidate_id]
        for d in output.candidate_decisions
        if d.decision.value == "KEEP"
    ]
    for decision in output.candidate_decisions:
        if decision.decision.value == "KEEP" and decision.confidence < 0.70:
            raise EvidenceContractError(
                candidates[decision.candidate_id].rule_id,
                "KEEP requires confidence >= 0.70",
            )
    detected = {f.rule_id for f in output.semantic_findings} | {c.rule_id for c in kept}
    required = {
        "rule_id",
        "status",
        "reason",
        "screen_ids",
        "checks",
        "choice_pairs",
        "price_comparisons",
    }
    for assessment in assessments:
        if set(assessment) != required or assessment["status"] not in STATUSES:
            raise ValueError("invalid rule_assessment fields or status")
        rule = assessment["rule_id"]
        if (
            not isinstance(assessment["reason"], str)
            or not assessment["reason"].strip()
        ):
            raise ValueError("Every rule assessment requires an evidence-based reason")
        if assessment["screen_ids"] != list(screens):
            raise ValueError(
                "Every rule assessment must cover every input screen in order"
            )
        if (assessment["status"] == "detected") != (rule in detected):
            raise EvidenceContractError(
                rule, f"{rule} assessment status disagrees with findings/KEEP decisions"
            )
        if not set(assessment["checks"]) <= CHECKS[rule]:
            raise EvidenceContractError(
                rule,
                f"{rule} assessment contains a check belonging to a different rule",
            )
        if rule in detected and not assessment["checks"]:
            raise EvidenceContractError(
                rule, f"{rule} detection requires an explicit check"
            )
        if rule == "DA-03" and rule in detected:
            pairs = assessment["choice_pairs"]
            for candidate in (c for c in kept if c.rule_id == rule):
                evidence = candidate.measurements.get("evidence", [])
                if not any(
                    p.get("screen_id") == candidate.screen_id
                    and _valid_pair_role(p, assessment["checks"])
                    and any(
                        e.get("element_id") == candidate.primary_element_id
                        and _label_matches(
                            p.get("accept_text", ""), e.get("text") or ""
                        )
                        for e in evidence
                    )
                    and any(
                        e.get("element_id") in candidate.related_element_ids
                        and e.get("screen_id") == candidate.screen_id
                        and _label_matches(
                            p.get("decline_text", ""), e.get("text") or ""
                        )
                        for e in evidence
                    )
                    for p in pairs
                ):
                    raise EvidenceContractError(
                        rule,
                        "DA-03 KEEP must verify the candidate's actual opposing actions",
                    )
            for finding in (f for f in output.semantic_findings if f.rule_id == rule):
                if not any(
                    p.get("screen_id") == finding.where.screen_ids[0]
                    and _label_matches(p.get("accept_text", ""), finding.where.element)
                    and any(
                        _label_matches(p.get("decline_text", ""), r.element)
                        for r in finding.related_elements
                    )
                    and _valid_pair_role(p, assessment["checks"])
                    for p in pairs
                ):
                    raise EvidenceContractError(
                        rule,
                        "DA-03 must identify actual accept and decline actions, not a warning paragraph",
                    )
        if rule == "DA-15" and rule in detected:
            comparisons = assessment["price_comparisons"]
            if not comparisons:
                raise EvidenceContractError(
                    rule, "DA-15 requires structured initial/final price evidence"
                )
            for comparison in comparisons:
                first, last = (
                    comparison.get("initial_screen_id"),
                    comparison.get("final_screen_id"),
                )
                if (
                    first not in screens
                    or last not in screens
                    or order[first] >= order[last]
                ):
                    raise EvidenceContractError(
                        rule,
                        "DA-15 requires initial and final screens in chronological order",
                    )
                a, b = screens[first], screens[last]
                if (
                    a.profile != b.profile
                    or a.path_id != b.path_id
                    or (a.state_id and a.state_id == b.state_id)
                ):
                    raise EvidenceContractError(
                        rule,
                        "DA-15 must compare different states of the same device and journey",
                    )
                if (
                    not comparison.get("product", "").strip()
                    or comparison.get("same_product") is not True
                ):
                    raise EvidenceContractError(
                        rule, "DA-15 must verify the same product"
                    )
                if (
                    comparison.get("explained_by_user_choice") is not False
                    or comparison.get("initially_disclosed") is not False
                ):
                    raise EvidenceContractError(
                        rule,
                        "DA-15 cannot infer a hidden charge from an explained or already disclosed price change",
                    )
                initial, final = (
                    comparison.get("initial_amount"),
                    comparison.get("final_amount"),
                )
                if any(
                    isinstance(n, bool)
                    or not isinstance(n, (int, float))
                    or not math.isfinite(n)
                    or n < 0
                    for n in (initial, final)
                ):
                    raise EvidenceContractError(
                        rule, "DA-15 amounts must be finite nonnegative numbers"
                    )
                unit = comparison.get("unit")
                if not (
                    (unit == "KRW" and final > initial)
                    or (unit in {"percent", "percent_return"} and final < initial)
                    or (unit == "percent_cost" and final > initial)
                ):
                    raise EvidenceContractError(
                        rule,
                        "DA-15 price/rate direction or units do not support the claim",
                    )
            for finding in (f for f in output.semantic_findings if f.rule_id == rule):
                if not any(
                    c["initial_screen_id"] == finding.where.screen_ids[0]
                    and c["final_screen_id"] == finding.where.screen_ids[-1]
                    and any(
                        r.screen_id == c["initial_screen_id"]
                        for r in finding.related_elements
                    )
                    for c in comparisons
                ):
                    raise EvidenceContractError(
                        rule, "DA-15 finding must reference the compared price screens"
                    )
            for candidate in (c for c in kept if c.rule_id == rule):
                evidence_ids = {
                    e.get("screen_id")
                    for e in candidate.measurements.get("evidence", [])
                }
                if not any(
                    c["final_screen_id"] == candidate.screen_id
                    and {c["initial_screen_id"], c["final_screen_id"]} <= evidence_ids
                    for c in comparisons
                ):
                    raise EvidenceContractError(
                        rule,
                        "DA-15 KEEP must verify the candidate's original price evidence",
                    )
