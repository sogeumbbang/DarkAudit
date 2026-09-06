"""Command-line entry points for screenshot and URL audits."""
import argparse
import json
import os
import uuid
from pathlib import Path
from dotenv import load_dotenv
from ai.browser.explorer import HybridWebExplorer
from ai.browser.models import ScanMode
from ai.browser.playwright_driver import PlaywrightSessionFactory
from ai.browser.profiles import device_profile_names
from ai.browser.safety import UrlSafetyPolicy
from ai.pipeline.baseline import BaselineAuditPipeline
from ai.pipeline.web_audit import URLAuditPipeline, URLCapturePipeline
from ai.evaluation import DEFAULT_EVALUATION_RULE_IDS, Evaluator, report_json
from ai.providers.computer_use import OpenAIComputerUseAgent
from ai.providers.openai_provider import OpenAIResponsesProvider
from ai.schemas.audit_schema import AuditScreen, LLMAuditRequest

def build_parser() -> argparse.ArgumentParser:
    load_dotenv()
    parser = argparse.ArgumentParser(prog="darkaudit")
    sub = parser.add_subparsers(dest="command", required=True)
    audit = sub.add_parser("audit", help="Audit 1 to 5 screenshots")
    audit.add_argument("--image", action="append", required=True, type=Path)
    audit.add_argument("--flow-step", action="append", required=True)
    audit.add_argument("--screen-id", action="append")
    audit.add_argument("--audit-id", default=None)
    audit.add_argument("--model", default=os.getenv("DARKAUDIT_MODEL"))

    capture_url = sub.add_parser("capture-url", help="Capture a URL on desktop and mobile")
    _add_url_arguments(capture_url, include_audit_model=False)

    audit_url = sub.add_parser("audit-url", help="Capture a URL and run the DarkAudit model")
    _add_url_arguments(audit_url, include_audit_model=True)
    evaluate = sub.add_parser("evaluate", help="Evaluate prediction JSON against dataset labels")
    evaluate.add_argument("--dataset", type=Path, default=Path("data/synthetic/labels"))
    evaluate.add_argument("--predictions", type=Path, required=True)
    evaluate.add_argument("--iou-threshold", type=float, default=0.5)
    evaluate.add_argument("--input-usd-per-million", type=float)
    evaluate.add_argument("--output-usd-per-million", type=float)
    evaluate.add_argument("--rule-id", action="append", choices=sorted(DEFAULT_EVALUATION_RULE_IDS),
                          help="Rule scope; defaults to the current MVP rules")
    return parser


def _add_url_arguments(parser: argparse.ArgumentParser, *, include_audit_model: bool) -> None:
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", action="append", choices=device_profile_names())
    parser.add_argument("--mode", choices=[mode.value for mode in ScanMode], default=ScanMode.QUICK.value)
    parser.add_argument("--goal")
    parser.add_argument("--audit-id", default=None)
    parser.add_argument("--output-dir", type=Path, default=Path("data/captures"))
    parser.add_argument("--computer-model", default=os.getenv("DARKAUDIT_COMPUTER_MODEL"))
    parser.add_argument("--max-agent-turns", type=int, default=6)
    parser.add_argument("--allow-private-network", action="store_true")
    parser.add_argument("--headful", action="store_true")
    if include_audit_model:
        parser.add_argument("--model", default=os.getenv("DARKAUDIT_MODEL"))

def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "audit":
        return _run_image_audit(args)
    if args.command in {"capture-url", "audit-url"}:
        return _run_url_command(args)
    if args.command == "evaluate":
        evaluator = Evaluator()
        report = evaluator.evaluate_dataset(
            evaluator.load_dataset(args.dataset),
            evaluator.load_predictions(args.predictions),
            iou_threshold=args.iou_threshold,
            input_usd_per_million=args.input_usd_per_million,
            output_usd_per_million=args.output_usd_per_million,
            rule_ids=set(args.rule_id or DEFAULT_EVALUATION_RULE_IDS),
        )
        print(report_json(report))
        return 0
    raise SystemExit(f"Unsupported command: {args.command}")


def _run_image_audit(args: argparse.Namespace) -> int:
    if len(args.image) != len(args.flow_step): raise SystemExit("--image and --flow-step counts must match")
    if not 1 <= len(args.image) <= 5: raise SystemExit("Provide 1 to 5 images")
    ids = args.screen_id or [f"screen_{index:02d}" for index in range(1, len(args.image) + 1)]
    if len(ids) != len(args.image): raise SystemExit("--screen-id count must match --image count")
    if not args.model: raise SystemExit("Set --model or DARKAUDIT_MODEL")
    request = LLMAuditRequest(args.audit_id or f"audit_{uuid.uuid4().hex[:12]}",
                              tuple(AuditScreen(sid, step, image) for sid, step, image in zip(ids, args.flow_step, args.image)))
    pipeline = BaselineAuditPipeline(OpenAIResponsesProvider(args.model), allow_visual_fallback=True)
    result = pipeline.analyze(request)
    print(json.dumps({"output": result.to_dict(), "telemetry": pipeline.last_run_telemetry}, ensure_ascii=False, indent=2))
    return 0


def _run_url_command(args: argparse.Namespace) -> int:
    mode = ScanMode(args.mode)
    if mode is ScanMode.SMART and not args.computer_model:
        raise SystemExit("Set --computer-model or DARKAUDIT_COMPUTER_MODEL for smart mode")
    if args.command == "audit-url" and not args.model:
        raise SystemExit("Set --model or DARKAUDIT_MODEL")

    audit_id = args.audit_id or f"audit_{uuid.uuid4().hex[:12]}"
    computer_agent = (
        OpenAIComputerUseAgent(args.computer_model)
        if mode is ScanMode.SMART
        else None
    )
    session_factory = PlaywrightSessionFactory(
        args.output_dir,
        url_policy=UrlSafetyPolicy(allow_private_network=args.allow_private_network),
        headless=not args.headful,
    )
    explorer = HybridWebExplorer(
        session_factory,
        computer_agent=computer_agent,
        max_agent_turns=args.max_agent_turns,
    )
    capture_pipeline = URLCapturePipeline(explorer)
    common = {
        "audit_id": audit_id,
        "url": args.url,
        "profiles": tuple(args.profile or ("desktop", "mobile")),
        "mode": mode,
        "goal": args.goal,
    }

    if args.command == "capture-url":
        result = capture_pipeline.run(**common)
    else:
        result = URLAuditPipeline(
            capture_pipeline,
            BaselineAuditPipeline(OpenAIResponsesProvider(args.model)),
        ).run(**common)
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__": raise SystemExit(main())
