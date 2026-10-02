"""
하이브리드 파이프라인 성능 평가
------------------------------
Rule Engine 후보 + 멀티모달 LLM 검증을 실제로 돌려 정답 라벨과 대조한다.

eval_rule_engine.py 가 재는 것은 deterministic check 단독 성능이다. 이 스크립트는
그 뒤에 LLM 검증까지 붙은 최종 성능을 잰다. 두 수치를 나란히 놓아야 "하이브리드가
낫다"는 주장에 근거가 생긴다.

LLM 은 같은 입력에도 매번 다르게 답한다. 1회 측정값은 우연에 좌우되므로 --runs 로
여러 번 돌려 평균과 범위를 함께 남긴다.

    python eval_hybrid.py --runs 3
    python eval_hybrid.py --runs 1 --flows ins-001-risky,ins-002-risky   # 빠른 확인
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# backend/ 안에서 실행하면 ai 패키지가, 루트에서 실행하면 app 패키지가 안 잡힌다.
# 둘 다 경로에 넣어 실행 위치와 무관하게 동작시킨다.
_REPO_ROOT = Path(__file__).resolve().parents[1]
for _path in (_REPO_ROOT, _REPO_ROOT / "backend"):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from ai.browser.models import CaptureArtifact  # noqa: E402
from ai.pipeline.rule_candidates import candidate_payload, run_artifact_rules  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
SYNTHETIC = REPO / "data" / "synthetic"
UI, LABELS, SHOTS = SYNTHETIC / "ui", SYNTHETIC / "labels", SYNTHETIC / "screenshots"
OUT = REPO / "docs" / "eval"

TARGET = {"DA-03", "DA-04", "DA-07", "DA-12", "DA-15"}


def load_env() -> None:
    """.env 를 읽어 환경변수로 넣는다. 이미 설정된 값은 건드리지 않는다."""
    path = REPO / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def candidates_from_ui(flow_id: str, doc: dict) -> tuple[list[dict], dict[tuple[int, str], dict]]:
    """
    extract_ui.py 가 만든 UI JSON 에서 후보와 요소 사전을 만든다.

    후보는 운영 경로(URL 감사)와 같은 run_artifact_rules / candidate_payload 로 만든다.
    증거 계약(assessment_contract)은 후보의 measurements.evidence 와 모델 답변을
    대조하므로, 이 필드가 비면 DA-03·DA-15 KEEP 은 항상 계약에서 탈락한다.
    """
    indices, artifacts = [], []
    for screen in doc["screens"]:
        index = screen["screen_index"]
        screen_id = f"screen-{index:02d}"
        viewport = screen.get("viewport") or {}
        indices.append(index)
        artifacts.append(CaptureArtifact(
            screen_id=screen_id,
            flow_step=f"화면 {index}",
            profile="mobile",
            url="",
            title="",
            image_path=SHOTS / flow_id / f"{index:02d}.png",
            viewport_width=viewport.get("width", 0),
            viewport_height=viewport.get("height", 0),
            dom_elements=tuple(screen["elements"]),
            state_id=screen_id,
        ))

    # primary 요소가 없는 후보는 평가 대상에서 뺀다(이전 평가와 같은 기준).
    findings = [f for f in run_artifact_rules(flow_id, indices, tuple(artifacts)) if f.primary_id]
    payload = candidate_payload(findings, indices, tuple(artifacts))

    # 같은 element_id 가 여러 화면에 나오므로(예: 반복 노출되는 동의 문구) 화면까지 키에 넣는다.
    elements: dict[tuple[int, str], dict] = {}
    for screen in doc["screens"]:
        for element in screen["elements"]:
            elements[(screen["screen_index"], element["element_id"])] = {
                "screen_index": screen["screen_index"],
                "bbox": list(element["bbox"]),
            }
    return payload, elements


def candidates_for(flow_id: str) -> tuple[list[dict], dict[tuple[int, str], dict]]:
    """Rule Engine 을 돌려 후보와 요소 사전을 만든다."""
    doc = json.loads((UI / f"{flow_id}.json").read_text(encoding="utf-8"))
    return candidates_from_ui(flow_id, doc)


def to_detections(output, candidates: list[dict], elements: dict[tuple[int, str], dict]) -> list[dict]:
    """
    하이브리드 출력을 평가기가 아는 detections 형태로 옮긴다.

    평가기는 rule_id + screen_index + bbox IoU 로 정답과 대조한다. 모델이 쓴 설명
    문구는 보지 않으므로, 표현이 달라져도 같은 위치면 같은 탐지로 인정된다.
    """
    by_id = {item["candidate_id"]: item for item in candidates}
    detections = []

    for decision in output.candidate_decisions:
        if decision.decision.value != "KEEP":
            continue
        candidate = by_id.get(decision.candidate_id)
        if candidate is None:
            continue
        element = elements.get((candidate["screen_index"], candidate["primary_element_id"])) or {}
        detections.append({
            "rule_id": candidate["rule_id"],
            "bbox": element.get("bbox") or [0.0, 0.0, 0.0, 0.0],
            "where": {"screen_ids": [candidate["screen_id"]]},
            "screen_index": candidate["screen_index"],
            "source": "rule_engine+llm",
        })

    for finding in output.semantic_findings:
        detections.append({
            "rule_id": finding.rule_id,
            "bbox": list(finding.bbox),
            "where": {"screen_ids": list(finding.where.screen_ids)},
            "source": "llm_semantic",
        })
    return detections


def analyze_flow(flow_id: str, pipeline) -> dict:
    from ai.schemas.audit_schema import AuditScreen, LLMAuditRequest

    images = sorted((SHOTS / flow_id).glob("*.png"))
    if not images:
        raise FileNotFoundError(f"스크린샷이 없다: {SHOTS / flow_id}")
    request = LLMAuditRequest(
        flow_id,
        tuple(AuditScreen(f"screen-{i:02d}", f"화면 {i}", path) for i, path in enumerate(images, 1)),
    )
    candidates, elements = candidates_for(flow_id)
    started = time.perf_counter()
    output = pipeline.analyze(request, candidates)
    telemetry = dict(pipeline.last_run_telemetry)
    telemetry.setdefault("response_time_seconds", time.perf_counter() - started)
    telemetry["candidate_count"] = len(candidates)
    return {
        "flow_id": flow_id,
        "output": {"detections": to_detections(output, candidates, elements)},
        "telemetry": telemetry,
    }


def run_once(flow_ids: list[str], run_index: int, out_dir: Path) -> dict:
    from ai.evaluation import Evaluator
    from ai.pipeline.baseline import BaselineAuditPipeline
    from ai.providers.factory import create_provider

    pipeline = BaselineAuditPipeline(create_provider())
    predictions_dir = out_dir / f"run-{run_index}"
    predictions_dir.mkdir(parents=True, exist_ok=True)

    for position, flow_id in enumerate(flow_ids, 1):
        target = predictions_dir / f"{flow_id}.json"
        if target.exists():
            print(f"  [{position}/{len(flow_ids)}] {flow_id} (이미 있음, 건너뜀)")
            continue
        try:
            result = analyze_flow(flow_id, pipeline)
            target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            found = len(result["output"]["detections"])
            print(f"  [{position}/{len(flow_ids)}] {flow_id}  탐지 {found}건"
                  f"  {result['telemetry'].get('response_time_seconds', 0):.1f}s")
        except Exception as exc:  # 한 flow 가 실패해도 나머지는 계속 잰다.
            print(f"  [{position}/{len(flow_ids)}] {flow_id}  실패: {str(exc)[:120]}")

    evaluator = Evaluator()
    cases = [c for c in evaluator.load_dataset(LABELS) if c.flow_id in set(flow_ids)]
    predictions = evaluator.load_predictions(predictions_dir)
    return evaluator.evaluate_dataset(cases, predictions, rule_ids=TARGET)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--flows", default="", help="쉼표로 구분. 비우면 전체")
    args = parser.parse_args()

    load_env()
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY 가 필요하다 (.env 또는 환경변수)")
    os.environ.setdefault("DARKAUDIT_PROVIDER", "openai")

    flow_ids = ([f.strip() for f in args.flows.split(",") if f.strip()]
                or sorted(p.stem for p in UI.glob("*.json")))
    print(f"대상 {len(flow_ids)}개 flow, {args.runs}회 측정\n")

    out_dir = OUT / "hybrid"
    reports = []
    for index in range(1, args.runs + 1):
        print(f"── run {index}/{args.runs} ──")
        reports.append(run_once(flow_ids, index, out_dir))
        micro = reports[-1]["micro"]
        print(f"  micro P={micro['precision']:.2f} R={micro['recall']:.2f} F1={micro['f1']:.2f}\n")

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scope": "hybrid pipeline (rule engine candidates + multimodal LLM verification)",
        "model": os.getenv("DARKAUDIT_MODEL"),
        "runs": args.runs,
        "flows": len(flow_ids),
        # LLM 은 같은 입력에도 다르게 답한다. 1회 값만 남기면 우연을 성능으로 읽게 된다.
        "variation": {
            metric: {
                "mean": round(statistics.fmean(values), 4),
                "min": round(min(values), 4),
                "max": round(max(values), 4),
            }
            for metric in ("precision", "recall", "f1")
            for values in [[r["micro"][metric] for r in reports]]
        },
        "per_run": reports,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    body = json.dumps(summary, ensure_ascii=False, indent=2)
    path = OUT / "hybrid_report.json"
    path.write_text(body, encoding="utf-8")
    # 모델을 바꿔 다시 재면 이전 값이 덮여 비교할 수 없다. 모델명을 붙인 사본을
    # 함께 남겨 두고, 문서가 인용하는 경로(hybrid_report.json)는 최신을 가리킨다.
    model_slug = (summary["model"] or "unknown").replace("/", "-")
    (OUT / f"hybrid_report.{model_slug}.json").write_text(body, encoding="utf-8")

    print("=" * 46)
    for metric, stats in summary["variation"].items():
        print(f"{metric:<10} 평균 {stats['mean']:.2f}  범위 {stats['min']:.2f}~{stats['max']:.2f}")
    print(f"\n리포트 저장: {path.relative_to(REPO)}")


if __name__ == "__main__":
    main()
