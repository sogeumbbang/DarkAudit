"""Flow/rule decisions with explicit abstentions and end-to-end coverage."""
from __future__ import annotations

from .metrics import binary_scores, ratio


def prediction_failure(prediction: dict | None) -> str | None:
    if prediction is None:
        return "missing_prediction"
    if not isinstance(prediction, dict):
        return "invalid_prediction"
    telemetry = prediction.get("telemetry") or {}
    if not isinstance(telemetry, dict):
        return "invalid_prediction"
    if telemetry.get("failed") or prediction.get("error") or prediction.get("status") == "failed":
        return "analysis_failed"
    if "fake" in str(telemetry.get("provider", "")).lower() or "mock_analysis" in (telemetry.get("warnings") or []):
        return "mock_analysis"
    output = prediction.get("output")
    detections = output.get("detections") if isinstance(output, dict) else None
    if not isinstance(detections, list) or any(
        not isinstance(item, dict) or not isinstance(item.get("rule_id"), str)
        for item in detections
    ):
        return "invalid_prediction"
    return None


def rule_decisions(prediction: dict, rules: list[str]) -> tuple[dict[str, bool | None], list[str]]:
    """A finding is a positive; absence needs an explicit not_detected assessment."""
    predicted = {item["rule_id"] for item in prediction["output"]["detections"]}
    assessments = (prediction.get("telemetry") or {}).get("rule_assessments") or []
    if not isinstance(assessments, list):
        assessments = []
    decisions, incomplete = {}, []
    for rule in rules:
        statuses = [row.get("status") for row in assessments
                    if isinstance(row, dict) and row.get("rule_id") == rule]
        decisions[rule] = True if rule in predicted else False if statuses == ["not_detected"] else None
        if statuses != ["detected" if rule in predicted else "not_detected"]:
            incomplete.append(rule)
    return decisions, incomplete


def summarize_classification(cases, predictions: dict, rules: list[str]) -> dict:
    counts = {rule: dict(tp=0, fp=0, fn=0, tn=0, abstained_positive=0, abstained_negative=0) for rule in rules}
    failures, incomplete, rows = [], [], []
    exact = fully_assessed = complete = 0
    for case in cases:
        expected = {label["rule_id"] for label in case.labels}
        prediction = predictions.get(case.flow_id)
        failure = prediction_failure(prediction)
        if failure:
            failures.append({"flow_id": case.flow_id, "reason": failure})
            decisions = dict.fromkeys(rules)
        else:
            decisions, incomplete_rules = rule_decisions(prediction, rules)
            if incomplete_rules:
                incomplete.append({"flow_id": case.flow_id, "rule_ids": incomplete_rules})
            else:
                complete += 1
        all_assessed = all(value is not None for value in decisions.values())
        fully_assessed += all_assessed
        matched = all_assessed and all(decisions[rule] == (rule in expected) for rule in rules)
        exact += matched
        for rule, decision in decisions.items():
            positive = rule in expected
            if decision is None:
                key = "abstained_positive" if positive else "abstained_negative"
            elif decision:
                key = "tp" if positive else "fp"
            else:
                key = "fn" if positive else "tn"
            counts[rule][key] += 1
        rows.append({"flow_id": case.flow_id, "decisions": decisions, "exact_match": bool(matched)})

    def scores(count):
        result = binary_scores(*(count[key] for key in ("tp", "fp", "fn", "tn")))
        assessed = sum(count[key] for key in ("tp", "fp", "fn", "tn"))
        total = sum(count.values())
        return {
            **result,
            "abstained_positive": count["abstained_positive"],
            "abstained_negative": count["abstained_negative"],
            "assessed": assessed, "total": total,
            "coverage": ratio(assessed, total),
            "end_to_end_accuracy": ratio(count["tp"] + count["tn"], total),
            "end_to_end_recall": ratio(count["tp"], count["tp"] + count["fn"] + count["abstained_positive"]),
        }

    totals = {key: sum(count[key] for count in counts.values()) for key in next(iter(counts.values()))}
    return {
        "scope": "(flow, rule); accuracy/FPR use assessed pairs; abstentions are never true negatives",
        "micro": scores(totals), "per_rule": {rule: scores(count) for rule, count in counts.items()},
        "exact_match_accuracy": ratio(exact, len(cases)),
        "exact_match_count": exact, "fully_assessed_flows": fully_assessed,
        "complete_flows": complete, "completion_rate": ratio(complete, len(cases)),
        "analysis_failure_count": len(failures), "failure_rate": ratio(len(failures), len(cases)),
        "failed_cases": failures, "incomplete_count": len(incomplete), "incomplete_cases": incomplete,
        "per_flow": rows,
    }
