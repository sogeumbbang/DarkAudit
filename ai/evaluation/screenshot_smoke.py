"""Render canonical rule examples; opt in to live, screenshot-only smoke evaluation.

python -m ai.evaluation.screenshot_smoke --output /tmp/darkaudit-smoke --live
These authored examples are regression probes, not a representative accuracy benchmark.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import shutil

from ai.evaluation import DatasetCase, Evaluator

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = {
    "consent": ("DA-04", ["consent"]),
    "hierarchy": ("DA-03", ["hierarchy"]),
    "information": ("DA-07", ["information"]),
    "emotion": ("DA-12", ["emotion"]),
    "pricing": ("DA-15", ["price-first", "price-last"]),
}


def render_cases(directory: Path, names: list[str]):
    from playwright.sync_api import sync_playwright

    fixture = ROOT / "ai/tests/fixtures/screenshot_rule_cases.html"
    cases = []
    with sync_playwright() as manager:
        browser = manager.chromium.launch(executable_path=shutil.which("google-chrome"))
        try:
            page = browser.new_page(
                viewport={"width": 600, "height": 760}, device_scale_factor=1
            )
            for name in names:
                rule, steps = SCENARIOS[name]
                for variant in ("risky", "clean"):
                    identifier = f"{name}-{variant}"
                    paths, labels = [], []
                    for index, step in enumerate(steps, 1):
                        path = directory / f"{identifier}-{index}.png"
                        page.goto(f"{fixture.as_uri()}?case={step}&variant={variant}")
                        page.screenshot(path=str(path))
                        paths.append(path)
                        if variant == "risky" and index == len(steps):
                            boxes = page.locator("[data-target]").evaluate_all(
                                "nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x/600,r.y/760,r.width/600,r.height/760]})"
                            )
                            labels = [
                                {
                                    "rule_id": rule,
                                    "primary": {"screen_index": index, "bbox": box},
                                }
                                for box in boxes
                            ]
                    cases.append(
                        (
                            DatasetCase(identifier, name, variant, (), tuple(labels)),
                            paths,
                        )
                    )
        finally:
            browser.close()
    manifest = {
        "fixture_sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
        "cases": [
            {
                **asdict(case),
                "images": [
                    {
                        "file": p.name,
                        "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                    }
                    for p in paths
                ],
            }
            for case, paths in cases
        ],
    }
    (directory / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    return cases


def analyze_case(pair):
    from ai.pipeline.baseline import BaselineAuditPipeline
    from ai.providers import create_provider
    from ai.schemas.audit_schema import AuditScreen, LLMAuditRequest

    case, paths = pair
    provider = create_provider()
    if type(provider).__name__ == "FakeMultimodalProvider":
        raise ValueError("Live evaluation requires a real model provider, not fake")
    pipeline = BaselineAuditPipeline(provider, allow_visual_fallback=True)
    request = LLMAuditRequest(
        case.flow_id,
        tuple(
            AuditScreen(f"screen-{i:02d}", f"화면 {i}", path, "mobile", state_id=str(i))
            for i, path in enumerate(paths, 1)
        ),
    )
    output = pipeline.analyze(request).to_dict()
    return {
        "flow_id": case.flow_id,
        "output": {**output, "detections": output["semantic_findings"]},
        "telemetry": pipeline.last_run_telemetry,
    }


def main():
    from dotenv import load_dotenv
    from ai.schemas.audit_schema import SCHEMA_VERSION

    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--cases", nargs="+", choices=list(SCENARIOS), default=list(SCENARIOS)
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Calls the configured model; incurs API usage",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    cases = render_cases(args.output, args.cases)
    if not args.live:
        print(f"Rendered {len(cases)} cases to {args.output}")
        return 0
    predictions, errors = {}, {}

    def run(pair):
        try:
            return pair[0].flow_id, analyze_case(pair), None
        except Exception as exc:
            return pair[0].flow_id, None, f"{type(exc).__name__}: {exc}"

    with ThreadPoolExecutor(max_workers=2) as executor:
        for identifier, record, error in executor.map(run, cases):
            if error:
                errors[identifier] = error
            else:
                predictions[identifier] = record
                (args.output / f"{identifier}.json").write_text(
                    json.dumps(record, ensure_ascii=False, indent=2) + "\n"
                )
    report = Evaluator().evaluate_dataset([c for c, _ in cases], predictions)
    report.update(
        schema_version=SCHEMA_VERSION,
        errors=errors,
        scope="Authored screenshot-only smoke cases, one run; not general accuracy",
        findings_by_case={
            key: [d["rule_id"] for d in p["output"]["detections"]]
            for key, p in predictions.items()
        },
    )
    (args.output / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {"instance_detection": report["instance_detection"], "errors": errors},
            ensure_ascii=False,
        )
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
