"""URL capture and screenshot-audit composition."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

from PIL import Image

from ai.browser.explorer import HybridWebExplorer
from ai.browser.models import CaptureArtifact, CaptureResult, ScanMode
from ai.browser.profiles import get_device_profile
from ai.schemas.audit_schema import AuditScreen, HybridAuditOutput, LLMAuditRequest

from .baseline import BaselineAuditPipeline


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

    def to_dict(self) -> dict[str, Any]:
        result = {"capture": self.capture.to_dict(), "analysis": self.analysis.to_dict()}
        if self.telemetry is not None:
            result["telemetry"] = self.telemetry
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
        selected = select_analysis_artifacts(capture.artifacts, self.max_analysis_screens)
        request = LLMAuditRequest(
            audit_id,
            tuple(
                AuditScreen(artifact.screen_id, artifact.flow_step, artifact.image_path)
                for artifact in selected
            ),
        )
        analysis = self.audit_pipeline.analyze(request)
        telemetry = dict(self.audit_pipeline.last_run_telemetry)
        telemetry["url_exploration_success"] = bool(capture.artifacts)
        return URLAuditResult(capture, analysis, telemetry)


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
        if height <= artifact.viewport_height * 1.5 or max_segments <= 1:
            return (artifact,)

        segment_count = min(max_segments, math.ceil(height / artifact.viewport_height))
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
                )
            )
        return tuple(segments)
