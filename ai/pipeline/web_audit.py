"""URL capture and screenshot-audit composition."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, replace
from typing import Any

from PIL import Image

from ai.browser.explorer import HybridWebExplorer
from ai.browser.models import CaptureArtifact, CaptureResult, ScanMode
from ai.browser.profiles import get_device_profile
from ai.schemas.audit_schema import AuditScreen, HybridAuditOutput, LLMAuditRequest

from .baseline import BaselineAuditPipeline, _sum_usage
from .rule_candidates import run_artifact_rules, candidate_payload


@dataclass(frozen=True, slots=True)
class URLCaptureResult:
    audit_id: str
    url: str
    mode: ScanMode
    profiles: tuple[CaptureResult, ...]

    @property
    def artifacts(self) -> tuple[CaptureArtifact, ...]:
        return tuple(artifact for result in self.profiles for artifact in result.artifacts)

    def to_dict(self) -> dict[str, Any]:
        return {
            "auditId": self.audit_id,
            "url": self.url,
            "mode": self.mode.value,
            "profiles": [result.to_dict() for result in self.profiles],
        }


@dataclass(frozen=True, slots=True)
class URLAuditResult:
    capture: URLCaptureResult
    analysis: HybridAuditOutput
    telemetry: dict[str, Any] | None = None
    analysis_batches: tuple[HybridAuditOutput, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        result = {"capture": self.capture.to_dict(), "analysis": self.analysis.to_dict()}
        if self.telemetry is not None:
            result["telemetry"] = self.telemetry
        result["analysisBatches"] = [output.to_dict() for output in self.analysis_batches]
        return result


class URLCapturePipeline:
    def __init__(self, explorer: HybridWebExplorer) -> None:
        self.explorer = explorer

    def run(
        self,
        *,
        audit_id: str,
        url: str,
        profiles: tuple[str, ...] = ("desktop", "mobile"),
        mode: ScanMode = ScanMode.QUICK,
        goal: str | None = None,
    ) -> URLCaptureResult:
        if not profiles:
            raise ValueError("At least one device profile is required")
        results = tuple(
            self.explorer.capture(
                audit_id=audit_id,
                url=url,
                profile=get_device_profile(profile_name),
                mode=mode,
                goal=goal,
            )
            for profile_name in profiles
        )
        return URLCaptureResult(audit_id, url, mode, results)


class URLAuditPipeline:
    def __init__(
        self,
        capture_pipeline: URLCapturePipeline,
        audit_pipeline: BaselineAuditPipeline,
        *,
        max_analysis_screens: int = 5,
    ) -> None:
        if not 1 <= max_analysis_screens <= 5:
            raise ValueError("max_analysis_screens must be between 1 and 5")
        self.capture_pipeline = capture_pipeline
        self.audit_pipeline = audit_pipeline
        self.max_analysis_screens = max_analysis_screens

    def run(
        self,
        *,
        audit_id: str,
        url: str,
        profiles: tuple[str, ...] = ("desktop", "mobile"),
        mode: ScanMode = ScanMode.QUICK,
        goal: str | None = None,
    ) -> URLAuditResult:
        capture = self.capture_pipeline.run(
            audit_id=audit_id,
            url=url,
            profiles=profiles,
            mode=mode,
            goal=goal,
        )
        selected = prepare_analysis_artifacts(capture.artifacts)
        outputs, batch_telemetry = [], []
        indices = {a.screen_id: i for i, a in enumerate(selected, 1)}
        batches = analysis_batches(selected, self.max_analysis_screens)
        for batch in batches:
            request = LLMAuditRequest(audit_id, tuple(
                AuditScreen(a.screen_id, a.flow_step, a.image_path, a.profile,
                            a.path_id, a.state_id or a.screen_id, a.dom_elements) for a in batch
            ))
            positions = [indices[a.screen_id] for a in batch]
            findings = run_artifact_rules(audit_id, positions, batch)
            candidates = candidate_payload(findings, positions, batch)
            # Same fallback policy as the HTTP service.
            from ai.schemas.audit_schema import SEMANTIC_ONLY_RULE_IDS, VISUAL_FALLBACK_RULE_IDS
            self.audit_pipeline.allowed_semantic_rule_ids = (
                VISUAL_FALLBACK_RULE_IDS if any(not a.dom_elements for a in batch) else SEMANTIC_ONLY_RULE_IDS
            )
            outputs.append(self.audit_pipeline.analyze(request, candidates))
            batch_telemetry.append(dict(self.audit_pipeline.last_run_telemetry))
        screens = {s.screen_id:s for output in outputs for s in output.screens}
        candidates = {c.candidate_id:c for output in outputs for c in output.candidates}
        decisions = {d.candidate_id:d for output in outputs for d in output.candidate_decisions}
        detections = {(d.rule_id,d.where.screen_ids,d.bbox):d for output in outputs for d in output.semantic_findings}
        analysis = HybridAuditOutput(audit_id, outputs[0].schema_version, tuple(screens.values()),
            tuple(decisions.values()),tuple(detections.values()),tuple(candidates.values()),
            frozenset(rule for output in outputs for rule in output.allowed_semantic_rule_ids))
        return URLAuditResult(capture, analysis, {
            "batches": batch_telemetry, "url_exploration_success": bool(capture.artifacts),
            "usage": _sum_usage([t["usage"] for t in batch_telemetry if t.get("usage")]),
            "warnings": [f"{p.profile}: {p.stop_reason}" for p in capture.profiles
                         if p.stop_reason != "Computer Use completed exploration"]
                        + (["long_flow_comparison_limited"] if any(
                            sum(a.profile == b.profile and a.path_id == b.path_id for b in selected)
                            > self.max_analysis_screens for a in selected) else []),
        }, tuple(outputs))


def select_analysis_artifacts(
    artifacts: tuple[CaptureArtifact, ...], limit: int = 5
) -> tuple[CaptureArtifact, ...]:
    if not artifacts:
        raise ValueError("URL capture produced no screenshots")
    if not 1 <= limit <= 5:
        raise ValueError("limit must be between 1 and 5")
    expanded: list[CaptureArtifact] = []
    for artifact in artifacts:
        if artifact.full_page:
            expanded.extend(_split_full_page_artifact(artifact, max_segments=max(1, limit - 1)))
        else:
            expanded.append(artifact)
    if len(expanded) <= limit:
        return tuple(expanded)
    if limit == 1:
        return (expanded[0],)

    last_index = len(expanded) - 1
    indices = [round(position * last_index / (limit - 1)) for position in range(limit)]
    return tuple(expanded[index] for index in indices)


def _split_full_page_artifact(
    artifact: CaptureArtifact,
    *,
    max_segments: int = 4,
) -> tuple[CaptureArtifact, ...]:
    """Turn a tall full-page screenshot into readable, exhaustive vertical sections."""
    with Image.open(artifact.image_path) as image:
        width, height = image.size
        if height <= (artifact.capture_height or artifact.viewport_height) * 1.5 or max_segments <= 1:
            return (artifact,)

        segment_count = min(max_segments, math.ceil(height / (artifact.capture_height or artifact.viewport_height)))
        segments: list[CaptureArtifact] = []
        for index in range(segment_count):
            top = math.floor(index * height / segment_count)
            bottom = math.ceil((index + 1) * height / segment_count)
            crop = image.crop((0, top, width, bottom))
            path = artifact.image_path.with_name(
                f"{artifact.image_path.stem}-segment-{index + 1:02d}.png"
            )
            crop.save(path, format="PNG")
            image_bytes = path.read_bytes()
            segments.append(
                CaptureArtifact(
                    screen_id=f"{artifact.screen_id}_segment_{index + 1:02d}",
                    flow_step=(
                        f"{artifact.profile}: full page · 구간 {index + 1}/{segment_count}"
                    ),
                    profile=artifact.profile,
                    url=artifact.url,
                    title=artifact.title,
                    image_path=path,
                    viewport_width=width,
                    viewport_height=bottom - top,
                    full_page=False,
                    action=artifact.action,
                    fingerprint=hashlib.sha256(image_bytes).hexdigest(),
                    dom_elements=_crop_dom(artifact.dom_elements, width, height, top, bottom),
                    visible_text=artifact.visible_text,
                    state_id=artifact.state_id or artifact.screen_id,
                    path_id=artifact.path_id,
                    capture_height=artifact.capture_height,
                    warnings=artifact.warnings,
                )
            )
        return tuple(segments)


def _crop_dom(elements: tuple[dict[str, Any], ...], width: int, height: int,
              top: int, bottom: int) -> tuple[dict[str, Any], ...]:
    """Clip normalized document rectangles into a crop's coordinate system."""
    cropped = []
    for element in elements:
        x, y, w, h = element["bbox"]
        left, right = max(0, x * width), min(width, (x + w) * width)
        upper, lower = max(top, y * height), min(bottom, (y + h) * height)
        if left >= right or upper >= lower:
            continue
        item = dict(element)
        item["bbox"] = [left / width, (upper - top) / (bottom - top),
                        (right - left) / width, (lower - upper) / (bottom - top)]
        item["computed_style"] = dict(element.get("computed_style") or {})
        item["computed_style"]["area_ratio"] = item["bbox"][2] * item["bbox"][3]
        cropped.append(item)
    return tuple(cropped)


def prepare_analysis_artifacts(artifacts: tuple[CaptureArtifact, ...]) -> tuple[CaptureArtifact, ...]:
    """Retain every captured state and readable crop; never sample away evidence."""
    expanded = []
    for artifact in artifacts:
        if artifact.full_page:
            # Each crop is at most roughly one viewport tall, with no 5-screen
            # global cap. The model call limit is handled by batching below.
            with Image.open(artifact.image_path) as image:
                count = max(2, math.ceil(image.height / (artifact.capture_height or artifact.viewport_height)))
            expanded.extend(_split_full_page_artifact(artifact, max_segments=count))
        else:
            expanded.append(artifact)
    if not expanded:
        raise ValueError("URL capture produced no screenshots")
    # Scope DOM identity to the image so identical controls on later screens
    # cannot overwrite previous evidence in the persistence lookup.
    return tuple(replace(a, dom_elements=tuple(
        {**e, "element_id": f"{a.screen_id}::{e['element_id']}"} for e in a.dom_elements
    )) for a in expanded)


def batch_indices(count: int, limit: int = 5) -> list[list[int]]:
    """Cover every image, retaining initial context and adjacent transitions."""
    if not 1 <= limit <= 5:
        raise ValueError("batch limit must be between 1 and 5")
    if not count:
        return []
    if limit == 1:
        return [[i] for i in range(count)]
    batches = [list(range(min(count, limit)))]
    start = limit
    while start < count:
        context = [0, start - 1] if limit >= 3 else [start - 1]
        end = min(count, start + limit - len(context))
        batches.append([*context, *range(start, end)])
        start = end
    return batches


def analysis_batches(artifacts: tuple[CaptureArtifact, ...], limit: int = 5) -> list[tuple[CaptureArtifact, ...]]:
    groups: dict[tuple[str, str], list[CaptureArtifact]] = {}
    for artifact in artifacts:
        groups.setdefault((artifact.profile, artifact.path_id), []).append(artifact)
    batches = []
    for group in groups.values():
        indices = batch_indices(len(group), limit)
        # Retain first/last native price evidence even when the first price
        # occurs after the journey's opening screen.
        prices = [i for i, a in enumerate(group) if any(
            e.get("element_type") == "price" for e in a.dom_elements)]
        if limit >= 2 and len(prices) >= 2:
            pair = [prices[0], prices[-1]]
            if not any(set(pair) <= set(batch) for batch in indices):
                indices.append(pair)
        batches.extend(tuple(group[i] for i in batch) for batch in indices)
    return batches
