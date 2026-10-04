import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from ai.evaluation import DatasetCase, Evaluator
from ai.evaluation.clean_regression import load_fixed_cases, main, summarize_clean_cases


def prediction(detections=(), statuses=None):
    return {
        "output": {"detections": [{"rule_id": rule} for rule in detections]},
        "telemetry": {"rule_assessments": [
            {"rule_id": rule, "status": status}
            for rule, status in (statuses or {"DA-03": "not_detected", "DA-07": "not_detected"}).items()
        ]},
    }


class CleanRegressionTest(unittest.TestCase):
    def test_fixed_suite_pins_eleven_existing_clean_flows(self):
        manifest, cases = load_fixed_cases()
        self.assertEqual(len(cases), 11)
        self.assertEqual(len(manifest["rule_ids"]), 5)
        self.assertTrue(all(case.variant == "clean" and not case.labels for case in cases))

    def test_counts_findings_rule_pairs_and_failures_separately(self):
        cases = [DatasetCase(name, name, "clean", (), ()) for name in ("clean", "fp", "missing", "failed", "incomplete")]
        predictions = {
            "clean": prediction(),
            "fp": prediction(["DA-07", "DA-07"], {"DA-03": "not_detected", "DA-07": "detected"}),
            "failed": {"output": {"detections": []}, "telemetry": {"failed": True}},
            "incomplete": prediction(statuses={"DA-03": "not_detected", "DA-07": "insufficient_evidence"}),
        }
        report = summarize_clean_cases(cases, predictions, {"DA-03", "DA-07"})
        self.assertEqual(report["false_positive_findings"], 2)
        self.assertEqual(report["false_positive_rule_cases"], 1)
        self.assertEqual(report["false_positive_flows"], 1)
        self.assertEqual(report["analysis_failure_count"], 2)
        self.assertEqual(report["incomplete_count"], 1)
        self.assertEqual(report["unassessed_rule_cases"], 5)
        self.assertEqual(report["per_rule"]["DA-07"]["fpr"], 0.5)
        self.assertEqual(report["fpr"], 0.2)

    def test_fake_and_invalid_results_cannot_be_counted_as_clean(self):
        cases = [DatasetCase(name, name, "clean", (), ()) for name in ("mock", "invalid", "unknown")]
        mock = prediction()
        mock["telemetry"]["provider"] = "FakeMultimodalProvider"
        report = summarize_clean_cases(cases, {
            "mock": mock, "invalid": {"output": {}}, "unknown": {"output": {"detections": []}},
        }, {"DA-03", "DA-07"})
        self.assertEqual(report["analysis_failure_count"], 2)
        self.assertEqual(report["incomplete_count"], 1)
        self.assertIsNone(report["fpr"])

    def test_evaluator_automatically_includes_clean_summary(self):
        case = DatasetCase("clean", "pair", "clean", (), ())
        report = Evaluator().evaluate_dataset([case], {}, rule_ids={"DA-07"})
        self.assertEqual(report["clean_regression"]["analysis_failure_count"], 1)
        self.assertIsNone(report["clean_regression"]["fpr"])

    def test_cli_fails_on_missing_or_false_positive_results(self):
        manifest, cases = load_fixed_cases()
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(["--predictions", directory]), 1)
            self.assertEqual(json.loads(output.getvalue())["analysis_failure_count"], 11)
            # These are metric fixtures, not measured model performance.
            for case in cases:
                result = prediction(statuses={rule: "not_detected" for rule in manifest["rule_ids"]})
                result["flow_id"] = case.flow_id
                (Path(directory) / f"{case.flow_id}.json").write_text(json.dumps(result))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--predictions", directory]), 0)
            path = Path(directory) / f"{cases[0].flow_id}.json"
            result = json.loads(path.read_text())
            result["output"]["detections"] = [{"rule_id": "DA-07"}]
            next(row for row in result["telemetry"]["rule_assessments"] if row["rule_id"] == "DA-07")["status"] = "detected"
            path.write_text(json.dumps(result))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--predictions", directory]), 1)
                self.assertEqual(main(["--predictions", directory, "--max-false-positive-findings", "1"]), 0)
            path.write_text("not json")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--predictions", directory]), 1)


if __name__ == "__main__":
    unittest.main()
