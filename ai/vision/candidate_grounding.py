"""Candidate-first grounding for compact controls in uploaded screenshots.

The multimodal audit finds the semantic evidence.  This module deliberately
does not ask it to calculate another coordinate: it produces deterministic UI
region proposals, labels them in an enlarged crop, and lets the provider select
one stable candidate id.
"""

from __future__ import annotations

import csv
import io
import math
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

NormalizedBBox = tuple[float, float, float, float]
CandidateSelector = Callable[[Path, str, list[dict[str, object]]], dict[str, object] | None]


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


def _parse_tesseract_tsv(payload: str, width: int, height: int) -> list[OCRAnchor]:
    """Collapse Tesseract words into line anchors with normalized coordinates."""

    groups: dict[tuple[str, str, str, str], list[dict[str, str]]] = {}
    reader = csv.DictReader(io.StringIO(payload), delimiter="\t")
    for row in reader:
        text = (row.get("text") or "").strip()
        try:
            confidence = float(row.get("conf") or -1)
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            box_width = int(row.get("width") or 0)
            box_height = int(row.get("height") or 0)
        except ValueError:
            continue
        if not text or confidence < 0 or box_width <= 0 or box_height <= 0:
            continue
        key = tuple(row.get(name) or "0" for name in ("page_num", "block_num", "par_num", "line_num"))
        groups.setdefault(key, []).append({
            "text": text,
            "conf": str(confidence),
            "left": str(left),
            "top": str(top),
            "width": str(box_width),
            "height": str(box_height),
        })

    anchors: list[OCRAnchor] = []
    for words in groups.values():
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        right = max(int(word["left"]) + int(word["width"]) for word in words)
        bottom = max(int(word["top"]) + int(word["height"]) for word in words)
        anchors.append(OCRAnchor(
            " ".join(word["text"] for word in words),
            (left / width, top / height, (right - left) / width, (bottom - top) / height),
            sum(float(word["conf"]) for word in words) / (100 * len(words)),
        ))
    return anchors


def extract_ocr_anchors(image_path: str | Path) -> list[OCRAnchor]:
    """Read Korean/English OCR boxes when Tesseract is available.

    OCR is an accuracy signal, not an availability dependency.  Local developer
    machines may omit Tesseract; the production Docker image installs it.
    """

    path = Path(image_path)
    try:
        with Image.open(path) as image:
            width, height = image.size
        completed = subprocess.run(
            [
                os.getenv("DARKAUDIT_TESSERACT_COMMAND", "tesseract"),
                str(path),
                "stdout",
                "-l",
                os.getenv("DARKAUDIT_TESSERACT_LANG", "kor+eng"),
                "--psm",
                "11",
                "tsv",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return []
    if completed.returncode != 0:
        return []
    return _parse_tesseract_tsv(completed.stdout, width, height)


def _text_similarity(needle: str, haystack: str) -> float:
    target = _normalize_text(needle)
    candidate = _normalize_text(haystack)
    if not target or not candidate:
        return 0.0
    if candidate in target or target in candidate:
        return min(len(candidate), len(target)) / max(len(candidate), len(target))
    target_tokens = {_normalize_text(token) for token in needle.split() if len(_normalize_text(token)) >= 2}
    candidate_tokens = {
        _normalize_text(token) for token in haystack.split() if len(_normalize_text(token)) >= 2
    }
    if not target_tokens or not candidate_tokens:
        return 0.0
    return len(target_tokens & candidate_tokens) / len(candidate_tokens | target_tokens)


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
        for pixel, background in zip(gray.getdata(), local.getdata(), strict=True)
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
) -> tuple[list[GroundingCandidate], tuple[int, int, int, int]]:
    """Generate square/radio/toggle proposals from independent visual signals."""

    image = image.convert("RGB")
    image_width, image_height = image.size
    roi = _roi_for(approximate_bbox, anchor, image_width, image_height)
    crop = image.crop(roi)
    scale = min(1.0, 1000 / max(crop.size))
    working = crop if scale == 1 else crop.resize(
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
    target_size = min(64.0, max(16.0, image_width * 0.065))

    anchor_pixels = _pixel_box(anchor.bbox, image_width, image_height) if anchor is not None else None
    for source, mask in _proposal_masks(working):
        for left, top, right, bottom, count in _connected_boxes(mask):
            box_width = (right - left) / scale
            box_height = (bottom - top) / scale
            if not (8 <= box_width <= min(140, image_width * 0.3)):
                continue
            if not (8 <= box_height <= min(100, image_height * 0.16)):
                continue
            aspect = box_width / box_height
            if not 0.5 <= aspect <= 3.8:
                continue
            density = count / max(1, (right - left) * (bottom - top))
            if source != "edge" and density < 0.08:
                continue

            absolute_left = roi[0] + left / scale
            absolute_top = roi[1] + top / scale
            center_x = absolute_left + box_width / 2
            center_y = absolute_top + box_height / 2
            distance = math.hypot(
                center_x - approximate_center[0], center_y - approximate_center[1]
            ) / max(target_size, 1)
            shape_penalty = min(abs(math.log(aspect)), abs(math.log(aspect / 2.0)))
            size_penalty = abs(math.log(max(box_height, 1) / target_size))
            score = distance + shape_penalty * 0.7 + size_penalty * 0.55
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
        duplicate = next(
            (item for item in merged if _intersection_over_union(bbox, item[0]) >= 0.62),
            None,
        )
        if duplicate is not None:
            duplicate[2].add(source)
            continue
        merged.append((bbox, score, {source}))
        if len(merged) >= limit:
            break

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
        draw.rectangle((left, top, right, bottom), outline=(220, 38, 38), width=3)
        badge = (left, max(0, top - 20), left + 28, max(18, top))
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
) -> GroundingResult:
    """Resolve an approximate DA-04 box to a deterministic control proposal."""

    path = Path(image_path)
    try:
        with Image.open(path) as source:
            image = source.convert("RGB")
    except (OSError, ValueError):
        return GroundingResult(approximate_bbox, 0.0, "model")

    anchors = list(ocr_anchors) if ocr_anchors is not None else extract_ocr_anchors(path)
    anchor = _best_anchor(element_text, anchors)
    candidates, roi = generate_control_candidates(image, approximate_bbox, anchor)
    if not candidates:
        return GroundingResult(approximate_bbox, 0.0, "model")

    selected = candidates[0]
    confidence = 0.58 if anchor is not None else 0.45
    source = "cv-ocr" if anchor is not None else "cv"
    if selector is not None:
        with tempfile.TemporaryDirectory(prefix="darkaudit-grounding-") as directory:
            marked_path = Path(directory) / "candidates.png"
            _draw_marked_crop(image, roi, candidates, marked_path)
            payload = [
                {
                    "candidate_id": candidate.candidate_id,
                    "bbox": list(candidate.bbox),
                    "sources": list(candidate.sources),
                }
                for candidate in candidates
            ]
            try:
                decision = selector(marked_path, element_text, payload)
            except Exception:
                decision = None
        if decision is not None:
            requested = str(decision.get("candidate_id") or "")
            matched = next((item for item in candidates if item.candidate_id == requested), None)
            if matched is not None:
                selected = matched
                raw_confidence = decision.get("confidence", 0.0)
                if isinstance(raw_confidence, (int, float)) and not isinstance(raw_confidence, bool):
                    confidence = min(1.0, max(0.0, float(raw_confidence)))
                source = "set-of-mark+" + source

    return GroundingResult(selected.bbox, confidence, source, selected.candidate_id)
