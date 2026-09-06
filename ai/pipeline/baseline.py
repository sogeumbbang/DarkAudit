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
from ai.vision.candidate_grounding import (
    extract_ocr_anchors,
    OCRAnchor,
    ground_selected_control_bbox,
    ground_text_bbox,
)
from ai.vision.ocr import OCRProvider, create_ocr_provider
from .assessment_contract import EvidenceContractError, _label_matches
from .response_parser import drop_disallowed_semantic_findings, parse_hybrid_response

MVP_RULE_IDS = frozenset({"DA-03", "DA-04", "DA-07", "DA-12", "DA-15"})

class BaselineAuditPipeline:
    def __init__(self, provider: MultimodalProvider, rule_loader: RuleLoader | None = None,
                 prompts_dir: Path | None = None, schema_path: Path | None = None,
                 max_attempts: int = 2, allow_visual_fallback: bool = False,
                 ocr_provider: OCRProvider | None = None) -> None:
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
        self.ocr_provider = ocr_provider or create_ocr_provider()
        self.last_run_telemetry: dict[str, Any] = {}
        self._grounding_usage: list[dict[str, int]] = []

    def analyze(
        self, request: LLMAuditRequest,
        candidates: list[dict[str, Any] | RuleCandidate] | None = None,
    ) -> HybridAuditOutput:
        evidence_warnings: list[str] = []
        analysis_usage = []
        self._grounding_usage = []
        enriched_screens = []
        for screen in request.screens:
            if screen.evidence:
                enriched_screens.append(screen)
                continue
            anchors = extract_ocr_anchors(screen.image_path, self.ocr_provider)
            if not anchors:
                evidence_warnings.append("ocr_evidence_unavailable")
            enriched_screens.append(replace(screen, evidence=tuple(
                {"text":a.text, "bbox":list(a.bbox), "source":"ocr", "confidence":a.confidence} for a in anchors
            )))
        request = replace(request, screens=tuple(enriched_screens))
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
        mode_prompt = "visual.md" if self.allowed_semantic_rule_ids == VISUAL_FALLBACK_RULE_IDS else "dom.md"
        base_audit_prompt += "\n\n" + (self.prompts_dir / mode_prompt).read_text(encoding="utf-8")
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
                usage = getattr(self.provider, "last_usage", None)
                if usage:
                    analysis_usage.append(dict(usage))
                if getattr(self.provider, "requires_rule_assessments", False) and "rule_assessments" not in raw:
                    raise ValueError("Model must assess all five rules in rule_assessments")
                self._deduplicate_raw(raw)
                # 정제 결과를 남긴다. 조용히 버리기만 하면 모델이 계속 규칙을
                # 어겨도 알 수 없다.
                dropped = drop_disallowed_semantic_findings(raw, self.allowed_semantic_rule_ids)
                while True:
                    try:
                        output = parse_hybrid_response(raw, request, parsed_candidates, self.allowed_semantic_rule_ids)
                        break
                    except EvidenceContractError as exc:
                        if attempt < self.max_attempts:
                            raise
                        # Preserve other rules after an unsuccessful correction,
                        # but explicitly mark this rule's evidence incomplete.
                        rule = exc.rule_id
                        evidence_warnings.append(f"evidence_contract:{rule}")
                        raw["semantic_findings"] = [f for f in raw["semantic_findings"] if f["rule_id"] != rule]
                        ids = {c.candidate_id for c in parsed_candidates if c.rule_id == rule}
                        for decision in raw["candidate_decisions"]:
                            if decision["candidate_id"] in ids:
                                decision.update(decision="REJECT", reason=str(exc))
                        for assessment in raw.get("rule_assessments", []):
                            if assessment["rule_id"] == rule:
                                assessment.update(status="insufficient_evidence", reason=str(exc),
                                                  choice_pairs=[], price_comparisons=[])

                result = self._filter_and_deduplicate(output)
                result, localizations = self._ground_visual_bboxes(result, request)
                self.last_run_telemetry = {
                    "response_time_seconds": time.perf_counter() - started,
                    "screen_count": len(request.screens),
                    "schema_attempts": attempt,
                    "schema_retries": attempt - 1,
                    "dropped_semantic_rule_ids": sorted(set(dropped)),
                    "usage": _sum_usage(analysis_usage + self._grounding_usage),
                    "analysis_usage": _sum_usage(analysis_usage),
                    "grounding_usage": _sum_usage(self._grounding_usage),
                    "bbox_localizations": localizations,
                    "rule_assessments": list(result.rule_assessments),
                    "provider": type(self.provider).__name__,
                    "model": getattr(self.provider, "model", None),
                    "warnings": evidence_warnings + (["mock_analysis"] if type(self.provider).__name__ == "FakeMultimodalProvider" else [])
                        + (["rule_assessments_missing"] if not result.rule_assessments else [])
                        + (["semantic_findings_dropped"] if dropped else [])
                        + (["ocr_evidence_unavailable"] if any(x.get("ocr_anchor_count") == 0 for x in localizations) else []),
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
        """Replace model-generated compact-control/CTA boxes with pixel proposals."""

        screens = {screen.screen_id: screen for screen in request.screens}
        provider_selector = getattr(self.provider, "select_bbox_candidate", None)
        def counted_selector(*args, **kwargs):
            self.provider.last_grounding_usage = None
            try:
                return provider_selector(*args, **kwargs)
            finally:
                usage = getattr(self.provider, "last_grounding_usage", None)
                if usage:
                    self._grounding_usage.append(dict(usage))
        selector = counted_selector if callable(provider_selector) else None
        findings = []
        telemetry: list[dict[str, Any]] = []
        anchor_cache: dict[Path, list] = {}
        for finding in output.semantic_findings:
            if finding.rule_id not in {"DA-03", "DA-04"}:
                findings.append(finding)
                continue
            screen = screens.get(finding.where.screen_ids[-1])
            if screen is None:
                findings.append(finding)
                continue
            if screen.image_path not in anchor_cache:
                anchor_cache[screen.image_path] = [
                    OCRAnchor(e["text"], tuple(e["bbox"]), float(e.get("confidence", 1.0)))
                    for e in screen.evidence if e.get("text") and e.get("bbox")
                ] or extract_ocr_anchors(screen.image_path, self.ocr_provider)
            anchors = anchor_cache[screen.image_path]
            grounding_text = " | ".join(
                value.strip()
                for value in (
                    finding.where.element,
                    finding.what,
                    finding.observation,
                )
                if value.strip()
            )
            grounded = ground_selected_control_bbox(
                screen.image_path,
                finding.bbox,
                grounding_text,
                selector=selector,
                ocr_anchors=anchors,
                rule_id=finding.rule_id,
                candidate_kind=(
                    "prominent_cta" if finding.rule_id == "DA-03" else "compact_control"
                ),
            )
            # A weak automatic proposal is less trustworthy than the model's own
            # evidence anchor.  Set-of-Mark selections and OCR-backed proposals
            # clear this threshold; CV-only guesses remain telemetry/fallback.
            applied = grounded.confidence >= 0.5 and grounded.bbox != finding.bbox
            updated = replace(finding, bbox=grounded.bbox) if applied else finding
            telemetry.append({
                "rule_id": finding.rule_id,
                "screen_id": screen.screen_id,
                "role": "primary",
                "candidate_id": grounded.candidate_id,
                "source": grounded.source,
                "confidence": grounded.confidence,
                "ocr_anchor_count": len(anchors),
                "applied": applied,
                "warning": grounded.warning,
            })
            if finding.rule_id == "DA-03":
                related_elements = []
                for related in updated.related_elements:
                    related_grounding = ground_text_bbox(
                        related.bbox,
                        related.element,
                        anchors,
                    )
                    related_applied = (
                        related_grounding.confidence >= 0.5
                        and related_grounding.bbox != related.bbox
                    )
                    related_elements.append(
                        replace(related, bbox=related_grounding.bbox)
                        if related_applied
                        else related
                    )
                    telemetry.append({
                        "rule_id": finding.rule_id,
                        "screen_id": related.screen_id,
                        "role": "related",
                        "candidate_id": related_grounding.candidate_id,
                        "source": related_grounding.source,
                        "confidence": related_grounding.confidence,
                        "ocr_anchor_count": len(anchors),
                        "applied": related_applied,
                    })
                updated = replace(updated, related_elements=tuple(related_elements))
            findings.append(updated)
        if tuple(findings) == output.semantic_findings:
            return output, telemetry
        return replace(output, semantic_findings=tuple(findings)), telemetry

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
            if finding.rule_id == "DA-03" and output.rule_assessments:
                pairs = [pair for assessment in output.rule_assessments if assessment["rule_id"] == "DA-03"
                         for pair in assessment["choice_pairs"] if pair["screen_id"] == finding.where.screen_ids[0]]
                finding = replace(finding, related_elements=tuple(
                    related for related in finding.related_elements
                    if any(_label_matches(pair["decline_text"], related.element) for pair in pairs)
                ))
            key = (finding.rule_id, tuple(sorted(finding.where.screen_ids)))
            if finding.confidence < 0.70:
                continue
            duplicate_key = (key, finding.where.element.strip().casefold(), finding.bbox)
            previous = kept.get(duplicate_key)
            if previous is None or finding.confidence > previous.confidence:
                kept[duplicate_key] = finding
        retained_rules = {f.rule_id for f in kept.values()} | {
            candidate.rule_id for candidate in output.candidates
            if any(d.candidate_id == candidate.candidate_id and d.decision.value == "KEEP" for d in output.candidate_decisions)
        }
        assessments = tuple(
            {**a, "status":"insufficient_evidence", "reason":"탐지 신뢰도가 기준에 미달했습니다."}
            if a["status"] == "detected" and a["rule_id"] not in retained_rules else a
            for a in output.rule_assessments
        )
        return replace(output, semantic_findings=tuple(kept.values()), rule_assessments=assessments)


def _sum_usage(rows: list[dict[str, int]]) -> dict[str, int] | None:
    if not rows:
        return None
    return {key: sum(row.get(key, 0) for row in rows)
            for key in ("input_tokens", "output_tokens", "total_tokens")}
