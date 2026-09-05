"""Tighten approximate vision boxes around compact selected controls."""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

from PIL import Image

from .candidate_grounding import generate_control_candidates

NormalizedBBox = tuple[float, float, float, float]


def _is_chromatic(pixel: tuple[int, ...]) -> bool:
    red, green, blue = pixel[:3]
    maximum = max(red, green, blue)
    minimum = min(red, green, blue)
    return maximum >= 55 and maximum - minimum >= 35 and (maximum - minimum) / maximum >= 0.22


@lru_cache(maxsize=256)
def refine_selected_control_bbox(image_path: str, bbox: NormalizedBBox) -> NormalizedBBox:
    """Snap an approximate DA-04 vision box to a nearby filled checkbox/radio/toggle.

    Vision models are good at identifying the selected option, but their normalized
    boxes are often deliberately coarse.  A compact chromatic connected component
    near that coarse box gives us a tighter, reproducible visual anchor.  If no
    convincing component exists, the model box is returned unchanged.
    """

    path = Path(image_path)
    if not path.is_file():
        return bbox

    try:
        source = Image.open(path)
    except (OSError, ValueError):
        return bbox

    with source:
        image = source.convert("RGB")
        image_width, image_height = image.size
        x, y, width, height = bbox
        box_left = x * image_width
        box_top = y * image_height
        box_width = width * image_width
        box_height = height * image_height
        box_center_x = box_left + box_width / 2
        box_center_y = box_top + box_height / 2

        pad_x = max(box_width * 1.75, image_width * 0.06)
        pad_y = max(box_height * 1.75, image_height * 0.035)
        roi_left = max(0, math.floor(box_left - pad_x))
        roi_top = max(0, math.floor(box_top - pad_y))
        roi_right = min(image_width, math.ceil(box_left + box_width + pad_x))
        roi_bottom = min(image_height, math.ceil(box_top + box_height + pad_y))
        roi_width = roi_right - roi_left
        roi_height = roi_bottom - roi_top
        if roi_width <= 0 or roi_height <= 0:
            return bbox

        pixels = image.load()
        mask = bytearray(roi_width * roi_height)
        for local_y in range(roi_height):
            for local_x in range(roi_width):
                if _is_chromatic(pixels[roi_left + local_x, roi_top + local_y]):
                    mask[local_y * roi_width + local_x] = 1

        candidates: list[tuple[float, tuple[int, int, int, int]]] = []
        for start in range(len(mask)):
            if not mask[start]:
                continue
            mask[start] = 0
            stack = [start]
            min_x = max_x = start % roi_width
            min_y = max_y = start // roi_width
            count = 0
            while stack:
                current = stack.pop()
                current_x = current % roi_width
                current_y = current // roi_width
                count += 1
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)
                for next_y in range(max(0, current_y - 1), min(roi_height, current_y + 2)):
                    row = next_y * roi_width
                    for next_x in range(max(0, current_x - 1), min(roi_width, current_x + 2)):
                        index = row + next_x
                        if mask[index]:
                            mask[index] = 0
                            stack.append(index)

            component_width = max_x - min_x + 1
            component_height = max_y - min_y + 1
            density = count / (component_width * component_height)
            aspect = component_width / component_height
            if not (
                component_width >= 16
                and component_height >= 16
                and component_width <= image_width * 0.22
                and component_height <= image_height * 0.12
                and 0.45 <= aspect <= 3.2
                and density >= 0.28
            ):
                continue

            absolute_left = roi_left + min_x
            absolute_top = roi_top + min_y
            center_x = absolute_left + component_width / 2
            center_y = absolute_top + component_height / 2
            distance = math.hypot(center_x - box_center_x, center_y - box_center_y)
            shape_penalty = abs(math.log(aspect)) * 8
            score = distance + shape_penalty - density * 12
            candidates.append(
                (score, (absolute_left, absolute_top, component_width, component_height))
            )

    if not candidates:
        return bbox

    _, (left, top, component_width, component_height) = min(candidates, key=lambda item: item[0])
    margin = 2
    left = max(0, left - margin)
    top = max(0, top - margin)
    right = min(image_width, left + component_width + margin * 2)
    bottom = min(image_height, top + component_height + margin * 2)
    return (
        round(left / image_width, 6),
        round(top / image_height, 6),
        round((right - left) / image_width, 6),
        round((bottom - top) / image_height, 6),
    )


@lru_cache(maxsize=256)
def refine_prominent_cta_bbox(image_path: str, bbox: NormalizedBBox) -> NormalizedBBox:
    """Snap a legacy DA-03 model box to a multi-channel filled CTA proposal."""

    path = Path(image_path)
    if not path.is_file():
        return bbox
    try:
        with Image.open(path) as source:
            candidates, _ = generate_control_candidates(
                source,
                bbox,
                kind="prominent_cta",
                limit=5,
            )
    except (OSError, ValueError):
        return bbox
    if not candidates:
        return bbox
    selected = candidates[0]
    if len(selected.sources) < 2 or selected.score > 1.5:
        return bbox
    return selected.bbox
