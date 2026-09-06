"""Retain individually valid findings when one rule's evidence fails validation."""

from copy import deepcopy
import json

from .response_parser import parse_hybrid_response
from .assessment_contract import _label_matches, _valid_pair_role


def recover_rule(raw, rule, request, candidates, allowed_rules):
    """Revalidate each item under the same contract; never lower its threshold."""
    candidate_rules = {c.candidate_id: c.rule_id for c in candidates}
    assessment = next(a for a in raw["rule_assessments"] if a["rule_id"] == rule)
    findings = [
        (i, f) for i, f in enumerate(raw["semantic_findings"]) if f["rule_id"] == rule
    ]
    decisions = [
        (i, d)
        for i, d in enumerate(raw["candidate_decisions"])
        if candidate_rules[d["candidate_id"]] == rule and d["decision"] == "KEEP"
    ]
    valid_findings, valid_decisions, reviews, errors = set(), set(), [], []
    for kind, items in (("finding", findings), ("candidate", decisions)):
        for index, item in items:
            isolated = deepcopy(raw)
            isolated["semantic_findings"] = (
                [deepcopy(item)] if kind == "finding" else []
            )
            for i, decision in enumerate(isolated["candidate_decisions"]):
                if kind != "candidate" or i != index:
                    decision["decision"] = "REJECT"
            for review in isolated["rule_assessments"]:
                review.update(
                    status="not_detected",
                    checks=[],
                    choice_pairs=[],
                    price_comparisons=[],
                )
            review = next(
                a for a in isolated["rule_assessments"] if a["rule_id"] == rule
            )
            review.update(deepcopy(assessment))
            review["status"] = "detected"
            if rule == "DA-03" and kind == "finding":
                review["choice_pairs"] = [
                    p
                    for p in review["choice_pairs"]
                    if p.get("screen_id") == item["where"]["screen_ids"][0]
                    and _label_matches(
                        p.get("accept_text", ""), item["where"]["element"]
                    )
                    and _valid_pair_role(p, review["checks"])
                ]
            if rule == "DA-15":
                if kind == "finding":
                    ids = item["where"]["screen_ids"]
                    review["price_comparisons"] = [
                        c
                        for c in review["price_comparisons"]
                        if c.get("initial_screen_id") == ids[0]
                        and c.get("final_screen_id") == ids[-1]
                    ]
                else:
                    candidate = next(
                        c for c in candidates if c.candidate_id == item["candidate_id"]
                    )
                    ids = {
                        e.get("screen_id")
                        for e in candidate.measurements.get("evidence", [])
                    }
                    review["price_comparisons"] = [
                        c
                        for c in review["price_comparisons"]
                        if c.get("final_screen_id") == candidate.screen_id
                        and c.get("initial_screen_id") in ids
                    ]
            try:
                parse_hybrid_response(isolated, request, candidates, allowed_rules)
            except ValueError as exc:
                errors.append(
                    {
                        "rule_id": rule,
                        "kind": kind,
                        "index": index,
                        "candidate_id": item.get("candidate_id"),
                        "screen_ids": item.get("where", {}).get("screen_ids", []),
                        "reason": str(exc),
                    }
                )
                continue
            (valid_findings if kind == "finding" else valid_decisions).add(index)
            reviews.append(review)
    raw["semantic_findings"] = [
        f
        for i, f in enumerate(raw["semantic_findings"])
        if f["rule_id"] != rule or i in valid_findings
    ]
    for i, decision in enumerate(raw["candidate_decisions"]):
        if (
            candidate_rules[decision["candidate_id"]] == rule
            and i not in valid_decisions
        ):
            decision.update(
                decision="REJECT", reason="이 항목의 필수 근거를 확인하지 못했습니다."
            )
    for key in ("checks", "choice_pairs", "price_comparisons"):
        unique = {
            json.dumps(v, sort_keys=True, ensure_ascii=False): v
            for review in reviews
            for v in review[key]
        }
        assessment[key] = list(unique.values())
    assessment["status"] = "detected" if reviews else "insufficient_evidence"
    assessment["reason"] = (
        "항목별 재검증을 통과한 탐지를 유지했습니다. 일부 근거는 확인하지 못했습니다."
        if reviews
        else "해당 규칙의 필수 근거를 확인하지 못했습니다."
    )
    return errors
