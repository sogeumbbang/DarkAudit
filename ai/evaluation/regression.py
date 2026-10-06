"""Evaluate independently labelled before/after decisions by stable problem ID."""
from __future__ import annotations

from .metrics import prf, ratio

STATES = ("resolved", "persisted", "improved", "new", "regressed", "pending")


def evaluate_regressions(rows: list[dict]) -> dict:
    counts = {state: [0, 0, 0] for state in STATES}
    confusion = {state: {predicted: 0 for predicted in (*STATES, "missing")} for state in (*STATES, "unexpected")}
    total = correct = missing = extra = false_resolved = predicted_resolved = 0
    details = []
    for row in rows:
        expected, predicted = row.get("expected"), row.get("predicted", {})
        if not isinstance(expected, dict) or not expected or not isinstance(predicted, dict):
            raise ValueError("Regression cases require nonempty expected and a predicted object")
        if any(not isinstance(key, str) or not key or value not in STATES
               for mapping in (expected, predicted) for key, value in mapping.items()):
            raise ValueError(f"Regression states must be one of {STATES}")
        errors = []
        for problem_id in sorted(expected.keys() | predicted.keys()):
            actual, result = expected.get(problem_id), predicted.get(problem_id)
            confusion[actual or "unexpected"][result or "missing"] += 1
            total += 1
            correct += actual == result
            missing += result is None
            extra += actual is None
            predicted_resolved += result == "resolved"
            false_resolved += result == "resolved" and actual != "resolved"
            for state in STATES:
                if actual == result == state:
                    counts[state][0] += 1
                elif result == state:
                    counts[state][1] += 1
                elif actual == state:
                    counts[state][2] += 1
            if actual != result:
                errors.append({"problem_id": problem_id, "expected": actual, "predicted": result})
        details.append({"id": row["id"], "errors": errors})
    scores = {state: prf(*count) for state, count in counts.items()}
    return {
        "scope": "stable problem IDs; missing and unexpected predictions count as incorrect",
        "cases": len(rows), "decisions": total, "accuracy": ratio(correct, total),
        "macro_f1": sum(score["f1"] for score in scores.values()) / len(STATES),
        "per_state": scores, "confusion_matrix": confusion,
        "missing_predictions": missing, "unexpected_predictions": extra,
        "prediction_coverage": ratio(total - extra - missing, total - extra),
        "false_resolved_count": false_resolved,
        "predicted_resolved_count": predicted_resolved,
        "false_resolved_rate": ratio(false_resolved, predicted_resolved),
        "per_case": details,
    }
