"""Candidate-first grounding for compact controls in uploaded screenshots.

The multimodal audit finds the semantic evidence.  This module deliberately
does not ask it to calculate another coordinate: it produces deterministic UI
region proposals, labels them in an enlarged crop, and lets the provider select
one stable candidate id.
"""

from __future__ import annotations

import math
import re
import tempfile
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable, Iterable, Literal

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from .ocr import OCRProvider, OCRResult, create_ocr_provider

NormalizedBBox = tuple[float, float, float, float]
CandidateSelector = Callable[[Path, str, list[dict[str, object]]], dict[str, object] | None]
CandidateKind = Literal["compact_control", "prominent_cta"]


@dataclass(frozen=True, slots=True)
class OCRAnchor:
    text: str
    bbox: NormalizedBBox
    confidence: float


@dataclass(frozen=True, slots=True)
class GroundingCandidate:
    candidate_id: str
    bbox: NormalizedBBox
    score: float
    sources: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class GroundingResult:
    bbox: NormalizedBBox
    confidence: float
    source: str
    candidate_id: str | None = None


def _normalize_text(value: str) -> str:
    return "".join(re.findall(r"[0-9A-Za-z가-힣]+", value.casefold()))


def ocr_result_to_anchors(
    result: OCRResult,
    width: int,
    height: int,
) -> list[OCRAnchor]:
    """Normalize OCR provider output once, at the CV pipeline boundary."""

    anchors: list[OCRAnchor] = []
    if width <= 0 or height <= 0:
        return anchors
    for block in result.blocks:
        if block.bbox is None or not block.text.strip():
            continue
        left, top, box_width, box_height = block.bbox
        if box_width <= 0 or box_height <= 0:
            continue
        normalized_left = min(1.0, max(0.0, left / width))
        normalized_top = min(1.0, max(0.0, top / height))
        anchors.append(OCRAnchor(
            block.text,
            (
                normalized_left,
                normalized_top,
                min(1.0 - normalized_left, box_width / width),
                min(1.0 - normalized_top, box_height / height),
            ),
            min(1.0, max(0.0, block.confidence)),
        ))
    return anchors


def extract_ocr_anchors(
    image_path: str | Path,
    provider: OCRProvider | None = None,
) -> list[OCRAnchor]:
    """Extract OCR geometry through the shared provider interface."""

    path = Path(image_path)
    try:
        with Image.open(path) as image:
            width, height = image.size
        result = (provider or create_ocr_provider()).extract(path)
    except Exception:
        # OCR enriches localization but must not make the main visual audit fail.
        return []
    return ocr_result_to_anchors(result, width, height)


def _text_similarity(needle: str, haystack: str) -> float:
    target = _normalize_text(needle)
    candidate = _normalize_text(haystack)
    if not target or not candidate:
        return 0.0
    character_score = SequenceMatcher(None, target, candidate).ratio()
    if candidate in target or target in candidate:
        return max(
            character_score,
            min(len(candidate), len(target)) / max(len(candidate), len(target)),
        )
    target_tokens = {_normalize_text(token) for token in needle.split() if len(_normalize_text(token)) >= 2}
    candidate_tokens = {
        _normalize_text(token) for token in haystack.split() if len(_normalize_text(token)) >= 2
    }
    if not target_tokens or not candidate_tokens:
        return character_score
    token_score = len(target_tokens & candidate_tokens) / len(candidate_tokens | target_tokens)
    return max(character_score, token_score)


def _best_anchor(element_text: str, anchors: Iterable[OCRAnchor]) -> OCRAnchor | None:
    ranked = [
        (_text_similarity(element_text, anchor.text) * 0.8 + anchor.confidence * 0.2, anchor)
        for anchor in anchors
    ]
    score, anchor = max(ranked, default=(0.0, None), key=lambda item: item[0])
    return anchor if anchor is not None and score >= 0.28 else None


def _pixel_box(bbox: NormalizedBBox, width: int, height: int) -> tuple[float, float, float, float]:
    x, y, box_width, box_height = bbox
    return x * width, y * height, box_width * width, box_height * height


def _roi_for(
    bbox: NormalizedBBox,
    anchor: OCRAnchor | None,
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    x, y, box_width, box_height = _pixel_box(bbox, width, height)
    left, top, right, bottom = x, y, x + box_width, y + box_height
    if anchor is not None:
        ax, ay, aw, ah = _pixel_box(anchor.bbox, width, height)
        left = min(left, ax - max(90, aw * 0.65))
        right = max(right, ax + aw)
        top = min(top, ay - max(35, ah * 1.5))
        bottom = max(bottom, ay + ah + max(35, ah * 1.5))
    pad_x = max(30, (right - left) * 0.35, width * 0.025)
    pad_y = max(30, (bottom - top) * 0.55, height * 0.02)
    target_width = max(180.0, right - left + 2 * pad_x)
    target_height = max(140.0, bottom - top + 2 * pad_y)
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    return (
        max(0, math.floor(center_x - target_width / 2)),
        max(0, math.floor(center_y - target_height / 2)),
        min(width, math.ceil(center_x + target_width / 2)),
        min(height, math.ceil(center_y + target_height / 2)),
    )


def _connected_boxes(mask: Image.Image) -> list[tuple[int, int, int, int, int]]:
    width, height = mask.size
    values = bytearray(mask.tobytes())
    boxes: list[tuple[int, int, int, int, int]] = []
    for start in range(len(values)):
        if values[start] == 0:
            continue
        values[start] = 0
        stack = [start]
        min_x = max_x = start % width
        min_y = max_y = start // width
        count = 0
        while stack:
            current = stack.pop()
            current_x = current % width
            current_y = current // width
            count += 1
            min_x = min(min_x, current_x)
            max_x = max(max_x, current_x)
            min_y = min(min_y, current_y)
            max_y = max(max_y, current_y)
            for next_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                row = next_y * width
                for next_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                    index = row + next_x
                    if values[index]:
                        values[index] = 0
                        stack.append(index)
        boxes.append((min_x, min_y, max_x + 1, max_y + 1, count))
    return boxes


def _proposal_masks(image: Image.Image) -> list[tuple[str, Image.Image]]:
    rgb = image.convert("RGB")
    hsv = rgb.convert("HSV")
    chromatic = hsv.point(lambda value: 255 if value >= 58 else 0).split()[1]

    gray = ImageOps.grayscale(rgb)
    edges = gray.filter(ImageFilter.FIND_EDGES).point(lambda value: 255 if value >= 28 else 0)
    edges = edges.filter(ImageFilter.MaxFilter(3))

    local = gray.filter(ImageFilter.GaussianBlur(5))
    contrast = Image.new("L", gray.size)
    contrast.putdata([
        255 if abs(pixel - background) >= 24 else 0
        for pixel, background in zip(gray.tobytes(), local.tobytes(), strict=True)
    ])
    contrast = contrast.filter(ImageFilter.MaxFilter(3))
    return [("color", chromatic), ("edge", edges), ("contrast", contrast)]


def _intersection_over_union(left: NormalizedBBox, right: NormalizedBBox) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    ix1, iy1 = max(lx, rx), max(ly, ry)
    ix2, iy2 = min(lx + lw, rx + rw), min(ly + lh, ry + rh)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = lw * lh + rw * rh - intersection
    return intersection / union if union else 0.0


def generate_control_candidates(
    image: Image.Image,
    approximate_bbox: NormalizedBBox,
    anchor: OCRAnchor | None = None,
    *,
    limit: int = 12,
    kind: CandidateKind = "compact_control",
) -> tuple[list[GroundingCandidate], tuple[int, int, int, int]]:
    """Generate compact-control or CTA proposals from independent visual signals."""

    image = image.convert("RGB")
    image_width, image_height = image.size
    roi = _roi_for(approximate_bbox, anchor, image_width, image_height)
    crop = image.crop(roi)
    # Small controls receive real pixels before feature extraction.  Most mobile
    # crops end up near 1000 px on their longest side; very small crops are capped
    # at 4x to avoid inventing excessive interpolation detail.
    scale = min(4.0, 1000 / max(crop.size))
    working = crop if abs(scale - 1.0) < 0.01 else crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )

    proposals: list[tuple[NormalizedBBox, float, str]] = []
    approximate_x, approximate_y, approximate_width, approximate_height = _pixel_box(
        approximate_bbox, image_width, image_height
    )
    approximate_center = (
        approximate_x + approximate_width / 2,
        approximate_y + approximate_height / 2,
    )
    target_size = (
        min(80.0, max(36.0, image_height * 0.075))
        if kind == "prominent_cta"
        else min(48.0, max(16.0, image_width * 0.065))
    )
    coarse_region = (
        approximate_width >= target_size * 3
        or approximate_height >= target_size * 3
    )

    anchor_pixels = _pixel_box(anchor.bbox, image_width, image_height) if anchor is not None else None
    for source, mask in _proposal_masks(working):
        for left, top, right, bottom, count in _connected_boxes(mask):
            box_width = (right - left) / scale
            box_height = (bottom - top) / scale
            aspect = box_width / box_height
            if kind == "prominent_cta":
                if not (image_width * 0.2 <= box_width <= image_width * 0.98):
                    continue
                if not (20 <= box_height <= min(150, image_height * 0.22)):
                    continue
                if not 1.5 <= aspect <= 20:
                    continue
            else:
                if not (8 <= box_width <= min(140, image_width * 0.3)):
                    continue
                if not (8 <= box_height <= min(100, image_height * 0.16)):
                    continue
                if not 0.5 <= aspect <= 3.8:
                    continue
            density = count / max(1, (right - left) * (bottom - top))
            if source != "edge" and density < 0.08:
                continue

            absolute_left = roi[0] + left / scale
            absolute_top = roi[1] + top / scale
            center_x = absolute_left + box_width / 2
            center_y = absolute_top + box_height / 2
            if coarse_region and kind == "compact_control":
                # A model may return an option-card box rather than its control.
                # Every proposal inside that card is equally local; shape and OCR
                # alignment must decide instead of distance from the card center.
                dx = max(
                    approximate_x - center_x,
                    0,
                    center_x - (approximate_x + approximate_width),
                )
                dy = max(
                    approximate_y - center_y,
                    0,
                    center_y - (approximate_y + approximate_height),
                )
                distance = math.hypot(dx, dy) / max(target_size, 1)
            else:
                distance = math.hypot(
                    center_x - approximate_center[0], center_y - approximate_center[1]
                ) / max(target_size, 1)
            shape_penalty = (
                abs(math.log(aspect / 5.0)) * 0.45
                if kind == "prominent_cta"
                else min(abs(math.log(aspect)), abs(math.log(aspect / 2.0)))
            )
            proposal_size = (
                box_height if kind == "prominent_cta" else math.sqrt(box_width * box_height)
            )
            size_penalty = abs(math.log(max(proposal_size, 1) / target_size))
            score = distance + shape_penalty * 1.1 + size_penalty * 0.85
            if kind == "compact_control" and min(box_width, box_height) < 14:
                score += 1.2
            if source == "color":
                score -= 0.35
            if anchor_pixels is not None:
                anchor_x, anchor_y, _, anchor_height = anchor_pixels
                anchor_center_y = anchor_y + anchor_height / 2
                vertical = abs(center_y - anchor_center_y) / max(target_size, anchor_height)
                score += vertical * 1.25
                if center_x <= anchor_x:
                    gap = anchor_x - (absolute_left + box_width)
                    score += max(0, gap - target_size * 3) / max(target_size, 1)
                    score -= 0.8
                else:
                    score += 1.0

            bbox = (
                absolute_left / image_width,
                absolute_top / image_height,
                box_width / image_width,
                box_height / image_height,
            )
            proposals.append((bbox, score, source))

    proposals.sort(key=lambda item: item[1])
    merged: list[tuple[NormalizedBBox, float, set[str]]] = []
    for bbox, score, source in proposals:
        duplicate_index = next(
            (
                index
                for index, item in enumerate(merged)
                if _intersection_over_union(bbox, item[0]) >= 0.62
            ),
            None,
        )
        if duplicate_index is not None:
            previous_bbox, previous_score, sources = merged[duplicate_index]
            sources.add(source)
            merged[duplicate_index] = (previous_bbox, min(previous_score, score), sources)
            continue
        merged.append((bbox, score, {source}))

    merged.sort(key=lambda item: item[1] - 0.3 * (len(item[2]) - 1))
    merged = merged[:limit]

    candidates = [
        GroundingCandidate(
            candidate_id=f"C{index}",
            bbox=tuple(round(value, 6) for value in bbox),  # type: ignore[arg-type]
            score=score,
            sources=tuple(sorted(sources)),
        )
        for index, (bbox, score, sources) in enumerate(merged, 1)
    ]
    return candidates, roi


def _draw_marked_crop(
    image: Image.Image,
    roi: tuple[int, int, int, int],
    candidates: list[GroundingCandidate],
    output_path: Path,
) -> None:
    crop = image.crop(roi).convert("RGB")
    scale = min(4.0, max(1.5, 1100 / max(crop.size)))
    marked = crop.resize(
        (round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS
    )
    draw = ImageDraw.Draw(marked)
    font = ImageFont.load_default(size=14)
    for candidate in candidates:
        x, y, width, height = _pixel_box(candidate.bbox, image.width, image.height)
        left = round((x - roi[0]) * scale)
        top = round((y - roi[1]) * scale)
        right = round((x + width - roi[0]) * scale)
        bottom = round((y + height - roi[1]) * scale)
        # Keep the mark outside the proposal so the verifier can still see a
        # checkbox border/check glyph only a few pixels wide.
        gap = 4
        mark = (
            max(0, left - gap),
            max(0, top - gap),
            min(marked.width - 1, right + gap),
            min(marked.height - 1, bottom + gap),
        )
        draw.rectangle(mark, outline=(220, 38, 38), width=3)
        if mark[1] >= 22:
            badge = (mark[0], mark[1] - 20, mark[0] + 28, mark[1] - 2)
        else:
            badge = (mark[0], mark[3] + 2, mark[0] + 28, mark[3] + 20)
        draw.rounded_rectangle(badge, radius=4, fill=(185, 28, 28))
        draw.text((badge[0] + 4, badge[1] + 2), candidate.candidate_id, fill="white", font=font)
    marked.save(output_path, format="PNG")


def ground_selected_control_bbox(
    image_path: str | Path,
    approximate_bbox: NormalizedBBox,
    element_text: str,
    *,
    selector: CandidateSelector | None = None,
    ocr_anchors: Iterable[OCRAnchor] | None = None,
    ocr_provider: OCRProvider | None = None,
    rule_id: str = "DA-04",
    candidate_kind: CandidateKind = "compact_control",
) -> GroundingResult:
    """Resolve an approximate model box to a deterministic UI proposal."""

    path = Path(image_path)
    try:
        with Image.open(path) as source:
            image = source.convert("RGB")
    except (OSError, ValueError):
        return GroundingResult(approximate_bbox, 0.0, "model")

    anchors = (
        list(ocr_anchors)
        if ocr_anchors is not None
        else extract_ocr_anchors(path, ocr_provider)
    )
    anchor = _best_anchor(element_text, anchors)
    candidates, roi = generate_control_candidates(
        image,
        approximate_bbox,
        anchor,
        kind=candidate_kind,
    )
    if not candidates:
        return GroundingResult(approximate_bbox, 0.0, "model")

    selected = candidates[0]
    agreement = min(3, len(selected.sources))
    confidence = 0.4 + agreement * 0.1
    if selected.score <= 1.0:
        confidence += 0.08
    if anchor is not None:
        confidence += 0.12
    confidence = min(0.82, confidence)
    source = "cv-ocr" if anchor is not None else "cv"
    if selector is not None:
        with tempfile.TemporaryDirectory(prefix="darkaudit-grounding-") as directory:
            marked_path = Path(directory) / "candidates.png"
            _draw_marked_crop(image, roi, candidates, marked_path)
            payload = [
                {
                    "candidate_id": candidate.candidate_id,
                    "rule_id": rule_id,
                    "kind": candidate_kind,
                    "sources": list(candidate.sources),
                }
                for candidate in candidates
            ]
            try:
                decision = selector(marked_path, element_text, payload)
            except Exception:
                decision = None
        if decision is not None:
            requested = str(
                decision.get("selected_candidate_id")
                or decision.get("candidate_id")
                or ""
            )
            if requested == "NONE":
                return GroundingResult(
                    approximate_bbox,
                    0.0,
                    "set-of-mark-rejected",
                )
            matched = next((item for item in candidates if item.candidate_id == requested), None)
            if matched is not None:
                selected = matched
                raw_confidence = decision.get(
                    "semantic_confidence", decision.get("confidence", 0.0)
                )
                if isinstance(raw_confidence, (int, float)) and not isinstance(raw_confidence, bool):
                    confidence = min(1.0, max(0.0, float(raw_confidence)))
                source = "set-of-mark+" + source

    return GroundingResult(selected.bbox, confidence, source, selected.candidate_id)


def ground_text_bbox(
    approximate_bbox: NormalizedBBox,
    element_text: str,
    ocr_anchors: Iterable[OCRAnchor],
) -> GroundingResult:
    """Use a semantically matching OCR line as a related-element bbox."""

    anchor = _best_anchor(element_text, ocr_anchors)
    if anchor is None:
        return GroundingResult(approximate_bbox, 0.0, "model")
    return GroundingResult(
        anchor.bbox,
        min(0.95, max(0.55, anchor.confidence)),
        "ocr-text",
    )
