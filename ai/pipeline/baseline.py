"""Screenshot-to-structured-JSON MVP baseline."""
import json
import time
from dataclasses import replace
from pathlib import Path
from typing import Any
from ai.providers.base import MultimodalProvider
from ai.rules.rule_loader import RuleLoader
from ai.schemas.audit_schema import (
    SEMANTIC_ONLY_RULE_IDS,
    VISUAL_FALLBACK_RULE_IDS,
    HybridAuditOutput,
    LLMAuditRequest,
    RuleCandidate,
)
from ai.vision.candidate_grounding import ground_selected_control_bbox
from .response_parser import drop_disallowed_semantic_findings, parse_hybrid_response

MVP_RULE_IDS = frozenset({"DA-03", "DA-04", "DA-07", "DA-12", "DA-15"})

class BaselineAuditPipeline:
    def __init__(self, provider: MultimodalProvider, rule_loader: RuleLoader | None = None,
                 prompts_dir: Path | None = None, schema_path: Path | None = None,
                 max_attempts: int = 2, allow_visual_fallback: bool = False) -> None:
        root = Path(__file__).parents[1]
        self.provider = provider
        self.rule_loader = rule_loader or RuleLoader()
        self.prompts_dir = prompts_dir or root / "prompts"
        self.schema_path = schema_path or root / "schemas" / "audit_output.schema.json"
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self.max_attempts = max_attempts
        self.allowed_semantic_rule_ids = (
            VISUAL_FALLBACK_RULE_IDS if allow_visual_fallback else SEMANTIC_ONLY_RULE_IDS
        )
        self.last_run_telemetry: dict[str, Any] = {}

    def analyze(
        self, request: LLMAuditRequest,
        candidates: list[dict[str, Any] | RuleCandidate] | None = None,
    ) -> HybridAuditOutput:
        parsed_candidates = [
            item if isinstance(item, RuleCandidate) else RuleCandidate.from_dict(item)
            for item in (candidates or [])
        ]
        candidate_payload = [
            {
                "candidate_id": item.candidate_id,
                "rule_id": item.rule_id,
                "screen_id": item.screen_id,
                "screen_index": item.screen_index,
                "primary_element_id": item.primary_element_id,
                "triggered_checks": list(item.triggered_checks),
                "measurements": item.measurements,
                "related_element_ids": list(item.related_element_ids),
            }
            for item in parsed_candidates
        ]
        base_audit_prompt = (self.prompts_dir / "audit_v1.md").read_text(encoding="utf-8")
        if self.allowed_semantic_rule_ids == VISUAL_FALLBACK_RULE_IDS:
            base_audit_prompt += """

## 스크린샷 전용 시각 판정

이 요청은 DOM Candidate를 만들 수 없는 이미지 업로드 진단이다. 따라서 화면에서 직접
확인 가능한 경우 DA-03, DA-04, DA-07, DA-12, DA-15를 semantic_findings로 반환할 수 있다.
DA-04는 유료 옵션의 선택 표시와 추가 비용이 모두 보여야 한다. DA-07은 중요한 정보가
작거나 저대비로 숨겨진 시각 근거가 있어야 한다. DA-15는 동일 기기 프로필의 서로 다른
두 화면 이상에서 초기 가격과 뒤늦게 증가한 가격이 확인되어야 한다.
"""
        arguments = {
            "request": request,
            "system_prompt": (self.prompts_dir / "system.md").read_text(encoding="utf-8"),
            "audit_prompt": base_audit_prompt,
            "rules": self.rule_loader.rules(rule_ids=MVP_RULE_IDS),
            "output_schema": json.loads(self.schema_path.read_text(encoding="utf-8")),
            "candidates": candidate_payload,
        }
        last_error: ValueError | None = None
        started = time.perf_counter()
        for attempt in range(1, self.max_attempts + 1):
            try:
                raw = self.provider.analyze(**arguments)
                self._deduplicate_raw(raw)
                # 정제 결과를 남긴다. 조용히 버리기만 하면 모델이 계속 규칙을
                # 어겨도 알 수 없다.
                dropped = drop_disallowed_semantic_findings(raw, self.allowed_semantic_rule_ids)
                output = parse_hybrid_response(
                    raw, request, parsed_candidates, self.allowed_semantic_rule_ids
                )
                result = self._filter_and_deduplicate(output)
                result, localizations = self._ground_visual_bboxes(result, request)
                self.last_run_telemetry = {
                    "response_time_seconds": time.perf_counter() - started,
                    "screen_count": len(request.screens),
                    "schema_attempts": attempt,
                    "schema_retries": attempt - 1,
                    "dropped_semantic_rule_ids": sorted(set(dropped)),
                    "usage": getattr(self.provider, "last_usage", None),
                    "bbox_localizations": localizations,
                }
                return result
            except ValueError as exc:
                last_error = exc
                arguments["audit_prompt"] = (
                    base_audit_prompt
                    + "\n\n## 이전 응답 수정\n"
                    + "이전 응답은 다음 애플리케이션 검증을 통과하지 못했습니다:\n"
                    + f"- {exc}\n"
                    + "입력의 audit_id, schema_version, screen_id, flow_step을 그대로 복사하고, "
                    + "위 오류를 수정한 전체 JSON 응답을 다시 생성하세요."
                )
        self.last_run_telemetry = {
            "response_time_seconds": time.perf_counter() - started,
            "screen_count": len(request.screens),
            "schema_attempts": self.max_attempts,
            "schema_retries": max(0, self.max_attempts - 1),
            "failed": True,
        }
        detail = str(last_error) if last_error is not None else "unknown validation error"
        raise ValueError(
            f"Model output failed validation after {self.max_attempts} attempts: {detail}"
        ) from last_error

    def _ground_visual_bboxes(
        self,
        output: HybridAuditOutput,
        request: LLMAuditRequest,
    ) -> tuple[HybridAuditOutput, list[dict[str, Any]]]:
        """Replace model-generated DA-04 coordinates with selected pixel proposals."""

        screens = {screen.screen_id: screen for screen in request.screens}
        provider_selector = getattr(self.provider, "select_bbox_candidate", None)
        selector = provider_selector if callable(provider_selector) else None
        findings = []
        telemetry: list[dict[str, Any]] = []
        for finding in output.semantic_findings:
            if finding.rule_id != "DA-04":
                findings.append(finding)
                continue
            screen = screens.get(finding.where.screen_ids[-1])
            if screen is None:
                findings.append(finding)
                continue
            grounded = ground_selected_control_bbox(
                screen.image_path,
                finding.bbox,
                finding.where.element,
                selector=selector,
            )
            # A weak automatic proposal is less trustworthy than the model's own
            # evidence anchor.  Set-of-Mark selections and OCR-backed proposals
            # clear this threshold; CV-only guesses remain telemetry/fallback.
            applied = grounded.confidence >= 0.5 and grounded.bbox != finding.bbox
            findings.append(replace(finding, bbox=grounded.bbox) if applied else finding)
            telemetry.append({
                "rule_id": finding.rule_id,
                "screen_id": screen.screen_id,
                "candidate_id": grounded.candidate_id,
                "source": grounded.source,
                "confidence": grounded.confidence,
                "applied": applied,
            })
        if tuple(findings) == output.semantic_findings:
            return output, telemetry
        return HybridAuditOutput(
            output.audit_id,
            output.schema_version,
            output.screens,
            output.candidate_decisions,
            tuple(findings),
            output.candidates,
            output.allowed_semantic_rule_ids,
        ), telemetry

    @staticmethod
    def _deduplicate_raw(raw: dict[str, Any]) -> None:
        """Collapse provider duplicates before strict cross-record validation."""
        detections = raw.get("semantic_findings")
        if not isinstance(detections, list):
            return
        kept: dict[tuple, dict[str, Any]] = {}
        passthrough: list[Any] = []
        for item in detections:
            try:
                where = item["where"]
                key = (
                    item["rule_id"], tuple(sorted(where["screen_ids"])),
                    str(where["element"]).strip().casefold(), tuple(item["bbox"]),
                )
                previous = kept.get(key)
                if previous is None or float(item["confidence"]) > float(previous["confidence"]):
                    kept[key] = item
            except (KeyError, TypeError, ValueError):
                passthrough.append(item)
        raw["semantic_findings"] = [*kept.values(), *passthrough]

    @staticmethod
    def _filter_and_deduplicate(output: HybridAuditOutput) -> HybridAuditOutput:
        """Drop weak semantic-only claims and collapse duplicate findings."""
        kept = {}
        for finding in output.semantic_findings:
            key = (finding.rule_id, tuple(sorted(finding.where.screen_ids)))
            if finding.confidence < 0.70:
                continue
            duplicate_key = (key, finding.where.element.strip().casefold(), finding.bbox)
            previous = kept.get(duplicate_key)
            if previous is None or finding.confidence > previous.confidence:
                kept[duplicate_key] = finding
        return HybridAuditOutput(
            output.audit_id, output.schema_version, output.screens,
            output.candidate_decisions, tuple(kept.values()), output.candidates,
            output.allowed_semantic_rule_ids,
        )
