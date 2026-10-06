import asyncio
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from ai.evaluation import DatasetCase, Evaluator
from ai.evaluation.__main__ import load_rows, main
from ai.evaluation.metrics import bbox_iou
from ai.evaluation.quality import RUBRICS, RubricJudge, evaluate_quality
from ai.evaluation.rag import RAG_FIELDS, collect_rag_cases, evaluate_rag
from ai.evaluation.regression import evaluate_regressions


def case(name, positive=False):
    labels = ({"rule_id": "DA-04", "primary": {"screen_index": 1, "bbox": [0, 0, 1, 1]}},) if positive else ()
    return DatasetCase(name, name, "risky" if positive else "clean", (), labels)


def prediction(positive=False, status=None):
    return {
        "output": {"detections": [{"rule_id": "DA-04", "bbox": [0, 0, 1, 1],
                                    "where": {"screen_ids": ["screen-01"]}}] if positive else []},
        "telemetry": {"rule_assessments": [{"rule_id": "DA-04", "status": status or (
            "detected" if positive else "not_detected")}], "provider": "real-provider"},
    }


class ClassificationFrameworkTests(unittest.TestCase):
    def test_abstentions_reduce_end_to_end_scores_without_inventing_true_negatives(self):
        cases = [case("tp", True), case("fn", True), case("fp"), case("tn"), case("missing", True), case("pending")]
        predictions = {"tp": prediction(True), "fn": prediction(), "fp": prediction(True),
                       "tn": prediction(), "pending": prediction(status="insufficient_evidence")}
        report = Evaluator().evaluate_dataset(cases, predictions, rule_ids={"DA-04"})
        self.assertEqual(report["micro"]["fn"], 2)
        self.assertAlmostEqual(report["micro"]["f1"], 0.4)
        scores = report["classification"]["micro"]
        self.assertEqual((scores["tp"], scores["fp"], scores["fn"], scores["tn"]), (1, 1, 1, 1))
        self.assertEqual(scores["accuracy"], 0.5)
        self.assertEqual(scores["balanced_accuracy"], 0.5)
        self.assertEqual(scores["fpr"], 0.5)
        self.assertAlmostEqual(scores["coverage"], 4 / 6)
        self.assertAlmostEqual(scores["end_to_end_accuracy"], 2 / 6)
        self.assertAlmostEqual(scores["end_to_end_recall"], 1 / 3)
        self.assertAlmostEqual(report["classification"]["exact_match_accuracy"], 2 / 6)
        self.assertEqual(report["classification"]["analysis_failure_count"], 1)
        self.assertEqual(report["classification"]["incomplete_count"], 1)
        self.assertAlmostEqual(report["localization"]["success_rate"], 1 / 3)

    def test_invalid_failed_and_fake_predictions_never_earn_credit(self):
        fake = prediction(True)
        fake["telemetry"]["provider"] = "FakeMultimodalProvider"
        failed = {**prediction(True), "status": "failed"}
        invalid = {"output": {"detections": [None]}}
        for bad in (fake, failed, invalid, [], {"telemetry": [1]}):
            with self.subTest(bad=bad):
                report = Evaluator().evaluate_dataset([case("a", True)], {"a": bad}, rule_ids={"DA-04"})
                self.assertEqual(report["micro"]["tp"], 0)
                self.assertEqual(report["micro"]["fn"], 1)
                self.assertEqual(report["classification"]["analysis_failure_count"], 1)

    def test_absence_without_assessment_is_not_a_true_negative(self):
        unknown = {"output": {"detections": []}}
        report = Evaluator().evaluate_dataset([case("a")], {"a": unknown}, rule_ids={"DA-04"})
        scores = report["classification"]["micro"]
        self.assertIsNone(scores["accuracy"])
        self.assertIsNone(scores["specificity"])
        self.assertEqual(scores["tn"], 0)
        self.assertEqual(scores["end_to_end_accuracy"], 0)
        self.assertEqual(report["classification"]["exact_match_accuracy"], 0)

    def test_missing_counterfactual_pair_stays_in_denominator(self):
        cases = [DatasetCase("clean", "pair", "clean", (), ()),
                 DatasetCase("risky", "pair", "risky", (), case("risky", True).labels)]
        report = Evaluator().evaluate_dataset(cases, {"clean": prediction()}, rule_ids={"DA-04"})
        cf = report["counterfactual_consistency"]
        self.assertEqual((cf["score"], cf["comparisons"], cf["pairs"], cf["expected_pairs"]), (0, 1, 0, 1))

    def test_duplicate_cases_and_empty_rule_scope_are_rejected(self):
        for cases, rules in (([case("a"), case("a")], {"DA-04"}), ([case("a")], set())):
            with self.assertRaises(ValueError):
                Evaluator().evaluate_dataset(cases, {}, rule_ids=rules)

    def test_bad_boxes_do_not_crash_or_match(self):
        for box in (None, [], [0, 1], [0, 0, -1, 1], [0, 0, float("nan"), 1], ["0", 0, 1, 1]):
            self.assertEqual(bbox_iou(box, [0, 0, 1, 1]), 0)
        result = Evaluator().evaluate_dataset([case("missing", True)], {}, rule_ids={"DA-04"}, iou_threshold=0)
        self.assertEqual(result["localization"]["success_rate"], 0)
        self.assertEqual(result["instance_detection"]["micro"]["tp"], 0)

    def test_prediction_loader_records_corruption_and_does_not_read_aggregate_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "a.json").write_text("broken", encoding="utf-8")
            (root / "b.json").write_text(json.dumps({"flow_id": "wrong", **prediction()}), encoding="utf-8")
            (root / "report.json").write_text("{}", encoding="utf-8")
            loaded = Evaluator.load_predictions(root, ["a", "b", "missing"])
            self.assertEqual(set(loaded), {"a", "b"})
            self.assertTrue(all(value["error"] == "invalid_prediction" for value in loaded.values()))


class RegressionFrameworkTests(unittest.TestCase):
    def test_false_resolution_missing_and_unexpected_items(self):
        report = evaluate_regressions([{"id": "pair", "expected": {"a": "persisted", "b": "resolved", "c": "pending"},
                                        "predicted": {"a": "resolved", "b": "resolved", "extra": "new"}}])
        self.assertEqual(report["accuracy"], 0.25)
        self.assertEqual(report["false_resolved_rate"], 0.5)
        self.assertEqual(report["missing_predictions"], 1)
        self.assertEqual(report["unexpected_predictions"], 1)
        self.assertEqual(report["per_state"]["pending"]["fn"], 1)
        self.assertEqual(report["confusion_matrix"]["pending"]["missing"], 1)
        self.assertAlmostEqual(report["prediction_coverage"], 2 / 3)

    def test_no_resolved_prediction_has_undefined_false_resolution_rate(self):
        report = evaluate_regressions([{"id": "p", "expected": {"a": "pending"}, "predicted": {"a": "pending"}}])
        self.assertIsNone(report["false_resolved_rate"])
        self.assertEqual(report["accuracy"], 1)


QUALITY_CASE = {"id": "finding-1", "evidence": "선택 동의가 기본 체크되어 있다.",
                "rule": "DA-04 선택 옵션의 사전선택", "explanation": "선택 동의가 미리 선택됨",
                "recommendation": "선택 동의의 기본 체크를 해제하세요."}


class QualityFrameworkTests(unittest.TestCase):
    def test_offline_judgments_preserve_reasons_and_report_missing_case(self):
        scores = {name: {"score": 4, "reason": "근거와 일치함"} for name in RUBRICS}
        report = evaluate_quality([QUALITY_CASE, {**QUALITY_CASE, "id": "missing"}],
                                  judgments={"finding-1": scores})
        self.assertEqual(report["coverage"], 0.5)
        self.assertEqual(report["failure_count"], 1)
        self.assertEqual(report["mean_scores"]["groundedness"], 4)
        self.assertEqual(report["per_case"][0]["scores"], scores)

    def test_invalid_judge_response_does_not_become_a_good_score(self):
        for score in (True, 0, 6, float("nan")):
            judgment = {name: {"score": score, "reason": "x"} for name in RUBRICS}
            report = evaluate_quality([QUALITY_CASE], judgments={"finding-1": judgment})
            self.assertEqual(report["coverage"], 0)
            self.assertIsNone(report["mean_scores"]["groundedness"])

    def test_live_adapter_uses_structured_rubric_and_verified_evidence(self):
        captured = {}
        judgment = {name: {"score": 4, "reason": "근거와 일치함"} for name in RUBRICS}

        def create(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_text=json.dumps(judgment))

        judge = RubricJudge("test-judge", client=SimpleNamespace(responses=SimpleNamespace(create=create)))
        self.assertEqual(judge.score(QUALITY_CASE), judgment)
        self.assertTrue(captured["text"]["format"]["strict"])
        self.assertIn(QUALITY_CASE["evidence"], captured["input"][0]["content"][0]["text"])


class RagFrameworkTests(unittest.TestCase):
    def test_collection_keeps_uncited_full_context_and_uses_production_answer_path(self):
        from ai.rag.chatbot import DarkPatternChatbot, StructuredAnswer
        from ai.rag.corpus import Chunk
        from ai.rag.retriever import ScoredChunk

        chunks = [ScoredChunk(Chunk(str(i), "title", "source", "section", "full text " * 50), 1)
                  for i in (1, 2)]

        class Retriever:
            def search(self, query, k):
                if query == "failure":
                    raise RuntimeError("retrieval failed")
                return chunks

        class Generator:
            def generate(self, question, history, context):
                return StructuredAnswer(True, "answer", (1,))

        chatbot = DarkPatternChatbot(Retriever(), Generator())
        questions = [{"id": "ok", "user_input": "question", "reference": "reference"},
                     {"id": "failed", "user_input": "failure", "reference": "reference"}]
        report = collect_rag_cases(questions, chatbot)
        self.assertEqual(report["coverage"], 0.5)
        self.assertEqual(report["samples"][0]["retrieved_contexts"], [item.chunk.text for item in chunks])
        self.assertEqual(report["samples"][0]["retrieved_context_ids"], ["1", "2"])
        self.assertEqual(report["samples"][1]["retrieved_contexts"], [])
        self.assertEqual(report["samples"][1]["error"], "RuntimeError")

    def test_collection_failure_remains_in_ragas_denominator_without_calls(self):
        row = {"id": "failed", "user_input": "q", "reference": "a", "error": "retrieval_failed"}
        report = asyncio.run(evaluate_rag([row], dict.fromkeys(RAG_FIELDS)))
        self.assertEqual(report["coverage"], 0)
        self.assertEqual(report["failure_count"], 1)

    def test_metric_inputs_failures_and_nonfinite_results(self):
        received = {}

        class Metric:
            def __init__(self, name):
                self.name = name

            async def ascore(self, **kwargs):
                received[self.name] = kwargs
                if self.name == "context_recall":
                    raise RuntimeError("judge unavailable")
                return SimpleNamespace(value=float("nan") if self.name == "context_precision" else 0.8)

        row = {"id": "q1", "user_input": "사전선택?", "response": "선택 동의 기본값 확인",
               "retrieved_contexts": ["선택 옵션은 기본 체크하지 않는다."], "reference": "선택 동의는 기본 해제"}
        report = asyncio.run(evaluate_rag([row], {name: Metric(name) for name in RAG_FIELDS}))
        self.assertEqual(report["failure_count"], 1)
        self.assertEqual(report["metrics"]["faithfulness"]["mean"], 0.8)
        self.assertIsNone(report["metrics"]["context_precision"]["mean"])
        self.assertEqual(received["context_recall"]["reference"], row["reference"])
        self.assertNotIn("reference", received["faithfulness"])
        self.assertEqual(received["response_relevancy"], {key: row[key] for key in ("user_input", "response")})
        json.dumps(report, allow_nan=False)


class EvaluationCliTests(unittest.TestCase):
    def test_detection_cli_gate_and_report_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            labels, predictions = root / "labels", root / "predictions"
            labels.mkdir()
            predictions.mkdir()
            (labels / "a.json").write_text(json.dumps({"flow_id": "a", "pair_id": "p", "variant": "clean", "screens": [], "labels": []}))
            arguments = ["detection", "--dataset", str(labels), "--predictions", str(predictions), "--rule-id", "DA-04"]
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(arguments), 1)
            (predictions / "a.json").write_text(json.dumps(prediction()))
            output = root / "result.json"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(arguments + ["--output", str(output)]), 0)
            report = json.loads(output.read_text())
            self.assertEqual(report["classification"]["micro"]["accuracy"], 1)
            self.assertTrue(report["inputs"]["dataset"]["sha256"])
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                main(arguments + ["--output", str(output)])
            self.assertEqual(error.exception.code, 2)

    def test_empty_and_duplicate_row_ids_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cases.json"
            for rows in ([], [{"id": "a"}, {"id": "a"}], [{"id": ""}]):
                path.write_text(json.dumps(rows))
                with self.assertRaises(ValueError):
                    load_rows(path)


if __name__ == "__main__":
    unittest.main()
