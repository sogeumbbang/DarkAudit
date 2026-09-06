"""Evaluate prediction JSON against the labelled synthetic dataset."""
from __future__ import annotations
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from .metrics import bbox_iou, prf, precision_recall_f1

_SCREEN_NUMBER = re.compile(r"(\d+)$")
DEFAULT_EVALUATION_RULE_IDS = frozenset({"DA-03", "DA-04", "DA-07", "DA-12", "DA-15"})

@dataclass(slots=True)
class EvaluationResult:
    cases: int
    precision: float
    recall: float
    f1: float

@dataclass(frozen=True, slots=True)
class DatasetCase:
    flow_id: str
    pair_id: str
    variant: str
    screens: tuple[dict[str, Any], ...]
    labels: tuple[dict[str, Any], ...]

class Evaluator:
    def evaluate_labels(self, predicted: list[set[str]], expected: list[set[str]]) -> EvaluationResult:
        if len(predicted) != len(expected): raise ValueError("Predicted and expected case counts differ")
        scores = [precision_recall_f1(p, e) for p, e in zip(predicted, expected)]
        if not scores: return EvaluationResult(0, 0.0, 0.0, 0.0)
        return EvaluationResult(len(scores), *(sum(row[i] for row in scores) / len(scores) for i in range(3)))

    @staticmethod
    def load_golden(path: str | Path) -> list[dict]:
        return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]

    @staticmethod
    def load_dataset(path: str | Path) -> list[DatasetCase]:
        root = Path(path); files = sorted(root.glob("*.json")) if root.is_dir() else [root]
        cases = []
        for file in files:
            doc = json.loads(file.read_text(encoding="utf-8"))
            cases.append(DatasetCase(doc["flow_id"], doc["pair_id"], doc["variant"],
                                     tuple(doc["screens"]), tuple(doc.get("labels") or ())))
        return cases

    @staticmethod
    def load_predictions(path: str | Path) -> dict[str, dict[str, Any]]:
        root = Path(path); files = sorted(root.glob("*.json")) if root.is_dir() else [root]
        predictions = {}
        for file in files:
            doc = json.loads(file.read_text(encoding="utf-8")); output = doc.get("output") or doc.get("analysis") or doc
            flow_id = doc.get("flow_id") or output.get("audit_id") or file.stem
            predictions[flow_id] = {"output": output, "telemetry": doc.get("telemetry") or {}}
        return predictions

    def evaluate_dataset(self, cases, predictions, *, iou_threshold: float = 0.5,
                         input_usd_per_million: float | None = None,
                         output_usd_per_million: float | None = None,
                         rule_ids: set[str] | None = None) -> dict[str, Any]:
        if not 0 <= iou_threshold <= 1: raise ValueError("iou_threshold must be between 0 and 1")
        missing = sorted(case.flow_id for case in cases if case.flow_id not in predictions)
        rules = sorted(DEFAULT_EVALUATION_RULE_IDS if rule_ids is None else rule_ids)
        counts = {rule: [0, 0, 0] for rule in rules}
        ious, location_hits, location_total = [], 0, 0
        for case in cases:
            if case.flow_id not in predictions:
                continue
            expected = {x["rule_id"] for x in case.labels if x["rule_id"] in rules}
            detections = [x for x in predictions.get(case.flow_id, {"output": {}})["output"].get("detections", [])
                          if x.get("rule_id") in rules]
            predicted = {x["rule_id"] for x in detections}
            for rule in rules:
                if rule in predicted and rule in expected: counts[rule][0] += 1
                elif rule in predicted: counts[rule][1] += 1
                elif rule in expected: counts[rule][2] += 1
            used_detections = set()
            for label in (x for x in case.labels if x["rule_id"] in rules and x.get("primary", {}).get("bbox")):
                location_total += 1; index = label["primary"]["screen_index"]
                matches = [(i, bbox_iou(label["primary"]["bbox"], x["bbox"]))
                           for i, x in enumerate(detections) if i not in used_detections
                           and x.get("rule_id") == label["rule_id"] and index in self._screen_indices(x)]
                best_index, best = max(matches, key=lambda pair: pair[1], default=(-1, 0.0))
                if best_index >= 0: used_detections.add(best_index)
                ious.append(best); location_hits += best >= iou_threshold
        per_rule = {rule: prf(*counts[rule]) for rule in rules}
        micro = prf(*(sum(counts[r][i] for r in rules) for i in range(3)))
        macro = {key: sum(float(per_rule[r][key]) for r in rules) / len(rules) if rules else 0.0
                 for key in ("precision", "recall", "f1")}
        telemetry = [predictions[case.flow_id].get("telemetry") or {}
                     for case in cases if case.flow_id in predictions]
        durations = [float(x["response_time_seconds"]) for x in telemetry if x.get("response_time_seconds") is not None]
        url = [bool(x["url_exploration_success"]) for x in telemetry if x.get("url_exploration_success") is not None]
        costs = []
        for item in telemetry:
            cost = item.get("cost_usd")
            usage = item.get("usage") or {}
            if cost is None and input_usd_per_million is not None and output_usd_per_million is not None:
                cost = (float(usage.get("input_tokens", 0)) * input_usd_per_million
                        + float(usage.get("output_tokens", 0)) * output_usd_per_million) / 1_000_000
            if cost is not None and int(item.get("screen_count", 0)) > 0:
                costs.append((float(cost), int(item["screen_count"])))
        attempts = sum(int(x.get("schema_attempts", 0)) for x in telemetry)
        retries = sum(int(x.get("schema_retries", 0)) for x in telemetry)
        retry_runs = sum(int(x.get("schema_retries", 0)) > 0 for x in telemetry if x.get("schema_attempts") is not None)
        measured_runs = sum(x.get("schema_attempts") is not None for x in telemetry)
        return {
            "dataset_cases": len(cases), "evaluated_cases": len(cases) - len(missing), "missing_predictions": missing,
            "per_rule": per_rule, "micro": micro, "macro": macro,
            "instance_detection": self._instance_detection(cases, predictions, rules, iou_threshold),
            "counterfactual_consistency": self._counterfactual(cases, predictions, rules),
            "localization": {"iou_threshold": iou_threshold, "mean_iou": sum(ious) / len(ious) if ious else None,
                             "success_rate": location_hits / location_total if location_total else None,
                             "evaluated_instances": location_total},
            "operations": {"url_exploration_success_rate": sum(url) / len(url) if url else None,
                           "average_response_time_seconds": sum(durations) / len(durations) if durations else None,
                           "model_cost_usd_per_screen": sum(x[0] for x in costs) / sum(x[1] for x in costs) if costs else None,
                           "schema_retry_rate": retries / attempts if attempts else None,
                           "schema_retry_run_rate": retry_runs / measured_runs if measured_runs else None,
                           "schema_attempts": attempts, "schema_retries": retries},
        }

    @staticmethod
    def _instance_detection(cases, predictions, rules, threshold):
        """One-to-one rule/screen/box matching, including missing-case misses."""
        counts = {rule: [0, 0, 0] for rule in rules}
        for case in cases:
            detections = predictions.get(case.flow_id, {}).get("output", {}).get("detections", [])
            for rule in rules:
                labels = [label for label in case.labels if label["rule_id"] == rule
                          and label.get("primary", {}).get("bbox")]
                found = [d for d in detections if d.get("rule_id") == rule]
                edges = []
                for label in labels:
                    matches = [(i, bbox_iou(label["primary"]["bbox"], d["bbox"]))
                               for i, d in enumerate(found) if d.get("bbox")
                               and label["primary"]["screen_index"] in Evaluator._screen_indices(d)]
                    edges.append([i for i, overlap in sorted(matches, key=lambda x: -x[1])
                                  if overlap >= threshold and overlap > 0])
                assigned = {}
                def assign(label_index, visited):
                    for i in edges[label_index]:
                        if i in visited:
                            continue
                        visited.add(i)
                        if i not in assigned or assign(assigned[i], visited):
                            assigned[i] = label_index
                            return True
                    return False
                for i in range(len(labels)):
                    assign(i, set())
                tp = len(assigned)
                for i, value in enumerate((tp, len(found) - tp, len(labels) - tp)):
                    counts[rule][i] += value
        return {
            "scope": "labelled element: same rule, screen and bbox IoU; missing predictions count as misses",
            "iou_threshold": threshold,
            "per_rule": {rule: prf(*counts[rule]) for rule in rules},
            "micro": prf(*(sum(counts[r][i] for r in rules) for i in range(3))),
            "prediction_coverage": sum(c.flow_id in predictions for c in cases) / len(cases) if cases else None,
        }

    @staticmethod
    def _screen_indices(item):
        result = set()
        for value in item.get("where", {}).get("screen_ids", []):
            match = _SCREEN_NUMBER.search(str(value))
            if match: result.add(int(match.group(1)))
        return result

    @staticmethod
    def _counterfactual(cases, predictions, rules):
        pairs = {}
        for case in cases: pairs.setdefault(case.pair_id, {})[case.variant] = case
        correct = total = complete = 0
        for variants in pairs.values():
            if not {"clean", "risky"} <= variants.keys(): continue
            clean, risky = variants["clean"], variants["risky"]
            if clean.flow_id not in predictions or risky.flow_id not in predictions: continue
            complete += 1
            expected = ({x["rule_id"] for x in clean.labels}, {x["rule_id"] for x in risky.labels})
            predicted = tuple({x.get("rule_id") for x in predictions.get(case.flow_id, {"output": {}})["output"].get("detections", [])}
                              for case in (clean, risky))
            for rule in rules:
                correct += ((rule in predicted[0], rule in predicted[1]) == (rule in expected[0], rule in expected[1]))
                total += 1
        return {"score": correct / total if total else None, "correct": correct, "comparisons": total, "pairs": complete}

def report_json(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2)
