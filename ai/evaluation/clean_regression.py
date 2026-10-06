"""Offline false-positive and failure accounting for the fixed clean-flow suite.

python -m ai.evaluation.clean_regression --predictions docs/eval/hybrid_visual/run-1
No model calls are made. Missing, failed, mock and incomplete results cannot pass the gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from .classification import prediction_failure

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "ai/evaluation/clean_cases.json"


def summarize_clean_cases(cases, predictions: dict, rule_ids) -> dict:
    rules = sorted(rule_ids)
    clean = [case for case in cases if case.variant == "clean"]
    per_rule = {rule: {"fp": 0, "tn": 0, "unassessed": 0} for rule in rules}
    failures, incomplete, flows = [], [], []
    finding_count = 0
    for case in clean:
        if any(label["rule_id"] in rules for label in case.labels):
            raise ValueError(f"Clean case has positive labels: {case.flow_id}")
        prediction = predictions.get(case.flow_id)
        failure = prediction_failure(prediction)
        if failure:
            failures.append({"flow_id": case.flow_id, "reason": failure})
            for counts in per_rule.values():
                counts["unassessed"] += 1
            continue

        telemetry = prediction.get("telemetry") or {}
        detections = prediction["output"]["detections"]
        findings = [item for item in detections if item["rule_id"] in rules]
        predicted = {item["rule_id"] for item in findings}
        assessments = telemetry.get("rule_assessments") or []
        if not isinstance(assessments, list):
            assessments = []
        statuses = {
            rule: [row.get("status") for row in assessments if isinstance(row, dict) and row.get("rule_id") == rule]
            for rule in rules
        }
        incomplete_rules = []
        for rule in rules:
            if rule in predicted:
                per_rule[rule]["fp"] += 1
            elif statuses[rule] == ["not_detected"]:
                per_rule[rule]["tn"] += 1
            else:
                per_rule[rule]["unassessed"] += 1
            expected_status = "detected" if rule in predicted else "not_detected"
            if statuses[rule] != [expected_status]:
                incomplete_rules.append(rule)
        if incomplete_rules:
            incomplete.append({"flow_id": case.flow_id, "rule_ids": incomplete_rules})
        finding_count += len(findings)
        flows.append({"flow_id": case.flow_id, "false_positive_findings": len(findings),
                      "false_positive_rule_ids": sorted(predicted)})

    for counts in per_rule.values():
        assessed = counts["fp"] + counts["tn"]
        counts["fpr"] = counts["fp"] / assessed if assessed else None
    fp = sum(counts["fp"] for counts in per_rule.values())
    tn = sum(counts["tn"] for counts in per_rule.values())
    fp_flows = sum(bool(flow["false_positive_findings"]) for flow in flows)
    return {
        "scope": "clean flows; FPR uses assessed (flow, rule) pairs; failures are never true negatives",
        "expected_flows": len(clean),
        "evaluated_flows": len(flows),
        "analysis_failure_count": len(failures),
        "failed_cases": failures,
        "incomplete_count": len(incomplete),
        "incomplete_cases": incomplete,
        "false_positive_findings": finding_count,
        "false_positive_rule_cases": fp,
        "false_positive_flows": fp_flows,
        "clean_flow_false_positive_rate": fp_flows / len(flows) if flows else None,
        "assessed_rule_cases": fp + tn,
        "unassessed_rule_cases": sum(counts["unassessed"] for counts in per_rule.values()),
        "fpr": fp / (fp + tn) if fp + tn else None,
        "per_rule": per_rule,
        "per_flow": flows,
    }


def load_fixed_cases(manifest_path: Path = DEFAULT_MANIFEST):
    from ai.evaluation.evaluator import Evaluator

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    cases = []
    for entry in manifest["cases"]:
        path = ROOT / "data/synthetic/labels" / f"{entry['flow_id']}.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        canonical = json.dumps(document, ensure_ascii=False, sort_keys=True).encode("utf-8")
        if hashlib.sha256(canonical).hexdigest() != entry["label_sha256"]:
            raise ValueError(f"Fixed clean label changed: {entry['flow_id']}; review before updating the manifest")
        case = Evaluator.load_dataset(path)[0]
        if case.flow_id != entry["flow_id"] or case.variant != "clean" or case.labels:
            raise ValueError(f"Invalid clean case: {entry['flow_id']}")
        cases.append(case)
    if not cases or len({case.flow_id for case in cases}) != len(cases):
        raise ValueError("Fixed clean suite must be nonempty and contain unique cases")
    return manifest, cases


def main(argv=None) -> int:
    from ai.evaluation.evaluator import Evaluator

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--max-false-positive-findings", type=int, default=0)
    parser.add_argument("--max-analysis-failures", type=int, default=0)
    args = parser.parse_args(argv)
    if min(args.max_false_positive_findings, args.max_analysis_failures) < 0:
        parser.error("thresholds must be nonnegative")
    manifest, cases = load_fixed_cases(args.manifest)
    if not args.predictions.is_dir():
        parser.error("--predictions must be a directory containing per-flow JSON results")
    # Only fixed cases are loaded: an aggregate report in the directory is not a prediction.
    predictions = {}
    for case in cases:
        path = args.predictions / f"{case.flow_id}.json"
        if not path.exists():
            continue
        try:
            loaded = Evaluator.load_predictions(path)
            if case.flow_id not in loaded:
                raise ValueError("prediction identity mismatch")
            predictions[case.flow_id] = loaded[case.flow_id]
        except (ValueError, TypeError, AttributeError):
            predictions[case.flow_id] = {"output": {}, "error": "invalid_prediction"}
    report = summarize_clean_cases(cases, predictions, manifest["rule_ids"])
    report["suite"] = manifest["suite"]
    report["passed"] = (
        report["false_positive_findings"] <= args.max_false_positive_findings
        and report["analysis_failure_count"] <= args.max_analysis_failures
        and report["incomplete_count"] == 0
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
