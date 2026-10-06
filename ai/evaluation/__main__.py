"""Dependency-light evaluation CLI: python -m ai.evaluation --help."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .evaluator import DEFAULT_EVALUATION_RULE_IDS, Evaluator


def load_rows(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    rows = ([json.loads(line) for line in text.splitlines() if line.strip()]
            if path.suffix == ".jsonl" else json.loads(text))
    if isinstance(rows, dict) and "samples" in rows:
        rows = rows["samples"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("Dataset must be a nonempty JSON array or JSONL file")
    ids = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip():
            raise ValueError("Each case requires a nonempty string id")
        ids.append(row["id"])
    if len(set(ids)) != len(ids):
        raise ValueError("Case IDs must be unique")
    return rows


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(path.glob("*.json")) if path.is_dir() else [path]
    for file in files:
        digest.update(file.name.encode("utf-8") + b"\0" + file.read_bytes() + b"\0")
    return digest.hexdigest()


def unit_interval(value: str) -> float:
    number = float(value)
    if not 0 <= number <= 1:
        raise argparse.ArgumentTypeError("must be between 0 and 1")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    detection = commands.add_parser("detection", help="Offline labels versus saved predictions")
    detection.add_argument("--dataset", type=Path, default=Path("data/synthetic/labels"))
    detection.add_argument("--predictions", type=Path, required=True)
    detection.add_argument("--rule-id", action="append", choices=sorted(DEFAULT_EVALUATION_RULE_IDS))
    detection.add_argument("--iou-threshold", type=unit_interval, default=0.5)
    detection.add_argument("--min-macro-f1", type=unit_interval)
    detection.add_argument("--max-clean-fpr", type=unit_interval)
    detection.add_argument("--min-completion", type=unit_interval, default=1.0)
    regression = commands.add_parser("regression", help="Offline labelled before/after statuses")
    regression.add_argument("--dataset", type=Path, required=True)
    regression.add_argument("--min-macro-f1", type=unit_interval)
    regression.add_argument("--max-false-resolved-rate", type=unit_interval, default=0.0)
    quality = commands.add_parser("quality", help="Judge explanations and recommendations")
    quality.add_argument("--dataset", type=Path, required=True)
    mode = quality.add_mutually_exclusive_group(required=True)
    mode.add_argument("--judgments", type=Path, help="Offline human/precomputed judgments JSONL")
    mode.add_argument("--judge-model", help="Explicitly run the rubric judge via the model API")
    quality.add_argument("--min-score", type=float)
    rag = commands.add_parser("rag", help="Run four Ragas metrics (model/embedding API calls)")
    rag.add_argument("--dataset", type=Path, required=True)
    rag.add_argument("--judge-model", required=True)
    rag.add_argument("--embedding-model", required=True)
    rag.add_argument("--min-score", type=unit_interval)
    collect = commands.add_parser("collect-rag", help="Capture chatbot answers and full contexts (API calls)")
    collect.add_argument("--dataset", type=Path, required=True, help="Questions with independent reference answers")
    collect.add_argument("--model", required=True)
    collect.add_argument("--embedding-model", required=True)
    for command in (detection, regression, quality, rag, collect):
        command.add_argument("--output", type=Path, help="Write a new JSON report; refuses overwrite")
    return parser


def evaluate(args: argparse.Namespace) -> dict:
    checks = []

    def check(name, actual, threshold, minimum=True):
        if threshold is not None:
            checks.append({"name": name, "actual": actual, "threshold": threshold,
                           "comparison": ">=" if minimum else "<=",
                           "passed": actual is not None and (actual >= threshold if minimum else actual <= threshold)})

    inputs = {"dataset": {"path": str(args.dataset), "sha256": fingerprint(args.dataset)}}
    if args.command == "detection":
        if not args.predictions.exists():
            raise ValueError("Predictions path does not exist")
        cases = Evaluator.load_dataset(args.dataset)
        if not cases:
            raise ValueError("Dataset contains no cases")
        predictions = Evaluator.load_predictions(args.predictions, [case.flow_id for case in cases])
        report = Evaluator().evaluate_dataset(cases, predictions, iou_threshold=args.iou_threshold,
                                             rule_ids=set(args.rule_id or DEFAULT_EVALUATION_RULE_IDS))
        inputs["predictions"] = {"path": str(args.predictions), "sha256": fingerprint(args.predictions)}
        check("completion_rate", report["classification"]["completion_rate"], args.min_completion)
        check("analysis_failure_count", report["classification"]["analysis_failure_count"], 0, False)
        check("macro_f1", report["macro"]["f1"], args.min_macro_f1)
        check("clean_fpr", report["clean_regression"]["fpr"], args.max_clean_fpr, False)
    else:
        rows = load_rows(args.dataset)
        if args.command == "regression":
            from .regression import evaluate_regressions
            report = evaluate_regressions(rows)
            check("prediction_coverage", report["prediction_coverage"], 1)
            check("unexpected_predictions", report["unexpected_predictions"], 0, False)
            check("macro_f1", report["macro_f1"], args.min_macro_f1)
            check("false_resolved_rate", report["false_resolved_rate"] if report["predicted_resolved_count"] else 0,
                  args.max_false_resolved_rate, False)
        elif args.command == "quality":
            from .quality import RubricJudge, evaluate_quality
            if args.min_score is not None and not 1 <= args.min_score <= 5:
                raise ValueError("--min-score must be between 1 and 5")
            if args.judgments:
                judgments = {row["id"]: row.get("scores") for row in load_rows(args.judgments)}
                report = evaluate_quality(rows, judgments=judgments)
                inputs["judgments"] = {"path": str(args.judgments), "sha256": fingerprint(args.judgments)}
            else:
                report = evaluate_quality(rows, judge=RubricJudge(args.judge_model))
                report["judge_model"] = args.judge_model
            check("coverage", report["coverage"], 1)
            for name, score in report["mean_scores"].items():
                check(name, score, args.min_score)
        elif args.command == "collect-rag":
            from .rag import collect_live_rag
            report = collect_live_rag(rows, args.model, args.embedding_model)
            check("coverage", report["coverage"], 1)
        else:
            from .rag import run_ragas
            report = asyncio.run(run_ragas(rows, args.judge_model, args.embedding_model))
            check("coverage", report["coverage"], 1)
            for name, metric in report["metrics"].items():
                check(name, metric["mean"], args.min_score)
    report.update(report_version=2, generated_at=datetime.now(timezone.utc).isoformat(),
                  evaluation=args.command, inputs=inputs, checks=checks,
                  passed=all(item["passed"] for item in checks))
    return report


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # Detect an existing destination before any optional paid judging calls.
    if args.output and args.output.exists():
        parser.error("--output already exists; choose a new report path")
    try:
        report = evaluate(args)
        body = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x", encoding="utf-8") as handle:
                handle.write(body + "\n")
        print(body)
        return 0 if report["passed"] else 1
    except (ValueError, OSError, RuntimeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
