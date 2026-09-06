"""
모델별 평가 결과 비교
--------------------
eval_hybrid.py 가 남긴 모델별 리포트를 나란히 놓는다. 모델을 바꿀 때 성능과
비용·지연이 어떻게 달라지는지 한 화면에서 보려는 목적이다.

    python compare_eval.py
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "docs" / "eval"


def rows() -> list[dict]:
    found = []
    for path in sorted(OUT.glob("hybrid_report.*.json")):
        report = json.loads(path.read_text(encoding="utf-8"))
        first = report["per_run"][0]
        operations = first.get("operations") or {}
        found.append({
            "model": report.get("model") or path.stem,
            "runs": report.get("runs"),
            "flows": report.get("flows"),
            "variation": report["variation"],
            "per_rule": first.get("per_rule", {}),
            "latency": operations.get("average_response_time_seconds"),
            "retry_rate": operations.get("schema_retry_rate"),
            "localization": (first.get("localization") or {}).get("success_rate"),
            "counterfactual": (first.get("counterfactual_consistency") or {}).get("score"),
        })
    return found


def main() -> None:
    found = rows()
    if not found:
        raise SystemExit("비교할 리포트가 없다. eval_hybrid.py 를 먼저 돌린다.")

    print(f"{'model':<20}{'F1':>16}{'P':>8}{'R':>8}{'지연(s)':>10}{'재시도':>8}{'위치':>7}")
    print("-" * 77)
    for row in found:
        f1 = row["variation"]["f1"]
        print(
            f"{row['model']:<20}"
            f"{f1['mean']:.3f} ({f1['min']:.2f}~{f1['max']:.2f})".rjust(16)
            + f"{row['variation']['precision']['mean']:>8.2f}"
            f"{row['variation']['recall']['mean']:>8.2f}"
            f"{(row['latency'] or 0):>10.1f}"
            f"{(row['retry_rate'] or 0):>8.0%}"
            f"{(row['localization'] or 0):>7.2f}"
        )

    rules = sorted({rule for row in found for rule in row["per_rule"]})
    if len(found) > 1 and rules:
        print(f"\n{'rule':<10}" + "".join(f"{row['model'][:18]:>20}" for row in found))
        print("-" * (10 + 20 * len(found)))
        for rule in rules:
            line = f"{rule:<10}"
            for row in found:
                scores = row["per_rule"].get(rule)
                line += (f"{scores['f1']:.2f} (P {scores['precision']:.2f})".rjust(20)
                         if scores else "-".rjust(20))
            print(line)


if __name__ == "__main__":
    main()
