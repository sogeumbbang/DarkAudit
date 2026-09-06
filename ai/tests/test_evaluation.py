import json
import tempfile
import unittest
from pathlib import Path

from ai.evaluation import DEFAULT_EVALUATION_RULE_IDS, DatasetCase, Evaluator


def detection(rule_id="DA-04", bbox=None):
    return {
        "rule_id": rule_id,
        "bbox": bbox or [0.1, 0.2, 0.2, 0.1],
        "where": {"screen_ids": ["screen_01"]},
    }


class DatasetEvaluationTest(unittest.TestCase):
    def test_instance_metrics_count_wrong_screen_and_missing_prediction_as_misses(self):
        case = DatasetCase("case", "pair", "risky", (), tuple(
            {"rule_id":"DA-07", "primary":{"screen_index":i,"bbox":[0.1,0.1,0.2,0.1]}}
            for i in (1,2)
        ))
        predictions = {"case":{"output":{"detections":[{
            "rule_id":"DA-07", "bbox":[0.7,0.7,0.1,0.1], "where":{"screen_ids":["screen-03"]}
        }]}}}
        report = Evaluator().evaluate_dataset([case],predictions,rule_ids={"DA-07"})
        self.assertEqual(report["micro"]["recall"],1)
        self.assertEqual(report["instance_detection"]["micro"]["recall"],0)
        self.assertEqual(report["instance_detection"]["micro"]["fn"],2)
        self.assertEqual(report["instance_detection"]["micro"]["fp"],1)
        missing = Evaluator().evaluate_dataset([case],{},rule_ids={"DA-07"})
        self.assertEqual(missing["instance_detection"]["micro"]["fn"],2)
        self.assertEqual(missing["instance_detection"]["prediction_coverage"],0)

    def test_instance_matching_finds_alternative_assignment_in_overlapping_boxes(self):
        case = DatasetCase("case", "pair", "risky", (), (
            {"rule_id":"DA-04","primary":{"screen_index":1,"bbox":[0.1,0.1,0.2,0.1]}},
            {"rule_id":"DA-04","primary":{"screen_index":1,"bbox":[0.2,0.1,0.2,0.1]}},
        ))
        predictions={"case":{"output":{"detections":[
            detection(bbox=[0.15,0.1,0.2,0.1]), detection(bbox=[0.05,0.1,0.2,0.1])
        ]}}}
        result=Evaluator().evaluate_dataset([case],predictions,rule_ids={"DA-04"})
        self.assertEqual(result["instance_detection"]["micro"]["tp"],2)

    def test_loads_real_label_dataset(self):
        cases = Evaluator.load_dataset(Path("data/synthetic/labels"))
        self.assertEqual(len(cases), 22)
        self.assertEqual(len({case.pair_id for case in cases}), 11)
        self.assertTrue(any(case.labels for case in cases))

    def test_reports_quality_localization_counterfactual_and_operations(self):
        cases = [
            DatasetCase("pair-clean", "pair", "clean", ({"screen_index": 1},), ()),
            DatasetCase("pair-risky", "pair", "risky", ({"screen_index": 1},), ({
                "rule_id": "DA-04", "primary": {"screen_index": 1, "bbox": [0.1, 0.2, 0.2, 0.1]},
            },)),
        ]
        predictions = {
            "pair-clean": {"output": {"detections": []}, "telemetry": {
                "response_time_seconds": 1, "screen_count": 1, "url_exploration_success": True,
                "schema_attempts": 1, "schema_retries": 0,
                "usage": {"input_tokens": 1000, "output_tokens": 100},
            }},
            "pair-risky": {"output": {"detections": [detection()]}, "telemetry": {
                "response_time_seconds": 3, "screen_count": 1, "url_exploration_success": False,
                "schema_attempts": 2, "schema_retries": 1,
                "usage": {"input_tokens": 1000, "output_tokens": 100},
            }},
        }
        report = Evaluator().evaluate_dataset(
            cases, predictions, input_usd_per_million=1, output_usd_per_million=2,
            rule_ids={"DA-04"},
        )
        self.assertEqual(report["micro"]["f1"], 1.0)
        self.assertEqual(report["macro"]["f1"], 1.0)
        self.assertEqual(report["counterfactual_consistency"]["score"], 1.0)
        self.assertEqual(report["localization"]["success_rate"], 1.0)
        self.assertEqual(report["operations"]["url_exploration_success_rate"], 0.5)
        self.assertEqual(report["operations"]["average_response_time_seconds"], 2.0)
        self.assertAlmostEqual(report["operations"]["model_cost_usd_per_screen"], 0.0012)
        self.assertAlmostEqual(report["operations"]["schema_retry_rate"], 1 / 3)

    def test_default_evaluation_scope_includes_da07(self):
        self.assertEqual(
            DEFAULT_EVALUATION_RULE_IDS,
            frozenset({"DA-03", "DA-04", "DA-07", "DA-12", "DA-15"}),
        )

    def test_loads_prediction_envelope(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "case.json"
            path.write_text(json.dumps({"flow_id": "flow", "output": {"detections": []},
                                        "telemetry": {"schema_attempts": 1}}), encoding="utf-8")
            loaded = Evaluator.load_predictions(directory)
            self.assertEqual(loaded["flow"]["telemetry"]["schema_attempts"], 1)


if __name__ == "__main__":
    unittest.main()
