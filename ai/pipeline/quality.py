"""Expose collection/verification limits separately from finding counts."""

from ai.schemas.audit_schema import RULE_BASE_SEVERITY


def describe_warning(code: str) -> str:
    if "evidence_contract:" in code:
        return "일부 규칙은 필수 근거를 확인하지 못했습니다. 해당 규칙의 검사 상태를 확인해 주세요."
    if "analysis_failed" in code:
        return "분석을 완료하지 못했습니다. 오류를 확인한 뒤 다시 시도해 주세요."
    if "long_flow_comparison_limited" in code:
        return "모든 수집 화면을 나누어 검사했습니다. 멀리 떨어진 모든 단계 간 가격 변화를 비교한 것은 아닙니다."
    if "mock_analysis" in code:
        return "모의 분석 결과입니다. 실제 다크패턴 검사를 수행한 결과가 아닙니다."
    if "bbox_verification" in code:
        return "일부 근거 위치를 추가 검증하지 못했습니다. 강조 위치를 확인해 주세요."
    if "ocr_" in code:
        return "일부 화면의 문자 위치를 추출하지 못해 위치 검증이 제한됐습니다."
    if "rule_assessments_missing" in code:
        return "규칙별 검사 완료 여부를 확인할 수 없습니다."
    if "semantic_findings_dropped" in code:
        return "일부 판정이 입력별 근거 기준을 충족하지 못해 제외됐습니다."
    if "dom_" in code:
        return "웹 요소 정보를 충분히 수집하지 못해 해당 화면은 이미지 근거로 검사했습니다."
    if "figma_canvas_order" in code:
        return (
            "캔버스 배치 순서를 사용했습니다. 실제 사용자 진행 순서와 다를 수 있습니다."
        )
    if "figma_render_missing" in code:
        return "일부 Figma 화면을 가져오지 못했습니다."
    if "figma_" in code:
        return "일부 Figma 화면이나 분기를 검사하지 못했습니다."
    if "android_screen_not_stable" in code:
        return "일부 앱 화면의 로딩 완료를 확인하지 못했습니다."
    if "android_" in code:
        return "앱 탐색이 제한되어 이후 단계나 일부 분기는 검사하지 못했습니다."
    if "quick capture" in code:
        return "빠른 캡처로 수집한 현재 페이지만 검사했습니다. 이후 진행 단계는 검사하지 않았습니다."
    if "policy" in code or "safety" in code:
        return "로그인·가입·결제 등 제한된 동작 이후의 화면은 검사하지 않았습니다."
    if "budget" in code:
        return "탐색 한도에 도달해 이후 단계는 검사하지 않았습니다."
    return "일부 분석 근거 또는 검사 범위가 제한됐습니다."


def summarize(summary: dict) -> dict:
    result = dict(summary)
    result.setdefault("supportedRules", sorted(RULE_BASE_SEVERITY))
    warnings = result.get("warnings", [])
    result["limitations"] = sorted({describe_warning(w) for w in warnings})
    batches = result.get("batches", [])
    assessments = []
    for rule in sorted(RULE_BASE_SEVERITY):
        rows = [
            a
            for batch in batches
            for a in batch.get("telemetry", {}).get("rule_assessments", [])
            if a["rule_id"] == rule
        ]
        if "mock_analysis" in warnings:
            status = "not_supported"
        elif any(a["status"] == "detected" for a in rows):
            status = "detected"
        elif (
            len(rows) != len(batches)
            or not rows
            or any(a["status"] == "insufficient_evidence" for a in rows)
        ):
            status = "insufficient_evidence"
        elif any(a["status"] == "not_supported" for a in rows):
            status = "not_supported"
        else:
            status = "not_detected"
        assessments.append(
            {
                "ruleId": rule,
                "status": status,
                "reasons": list(dict.fromkeys(a["reason"] for a in rows)),
            }
        )
    result["ruleAssessments"] = assessments
    result["analyzedScreenCount"] = len(
        {screen for batch in batches for screen in batch.get("screens", [])}
    )
    result["complete"] = (
        bool(batches)
        and not warnings
        and all(a["status"] in {"detected", "not_detected"} for a in assessments)
        and all(
            len(batch.get("telemetry", {}).get("rule_assessments", []))
            == len(RULE_BASE_SEVERITY)
            and all(
                a["status"] in {"detected", "not_detected"}
                for a in batch["telemetry"]["rule_assessments"]
            )
            for batch in batches
        )
    )
    return result
