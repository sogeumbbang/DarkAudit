"""Text-first grounding for DA-07 / DA-12 findings in uploaded screenshots.

DA-07(작은 안내 문구)·DA-12(감정적 문구)의 증거는 화면에 적힌 문장이다. 모델이 직접 계산한
좌표는 연한 작은 글씨나 줄바꿈된 버튼 라벨에서 빈 영역이나 한 줄만 가리키는 일이 잦으므로,
좌표 대신 **근거 문장**으로 위치를 찾는다.

1. 근거 문장 → OCR 줄 퍼지 매칭(rapidfuzz) → 매칭된 줄들의 합집합 박스
2. 매칭 실패 시 인접 OCR 줄을 문단으로 묶어 T1..Tn 후보를 만들고 모델이 번호를 고르게 한다
   (candidate_grounding 의 C1..Cn 방식과 같다)
3. 둘 다 실패하면 모델 박스를 유지하고 어느 경로를 탔는지(`grounding_method`)만 남긴다

기본 OCR 은 연한 회색 작은 글씨를 거의 읽지 못하므로, 대비를 키워 한 번 더 읽은 줄을 합친다.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median
from typing import Callable, Iterable, Sequence

from PIL import Image, ImageOps
from rapidfuzz import fuzz

from .candidate_grounding import (
    NormalizedBBox,
    OCRAnchor,
    _draw_marked_crop,
    _intersection_over_union,
    extract_ocr_anchors,
    ocr_result_to_anchors,
)
from .ocr import OCRProvider

TEXT_GROUNDING_RULE_IDS = frozenset({"DA-07", "DA-12"})

# grounding_method 값
METHOD_OCR_FUZZY = "ocr_fuzzy"
METHOD_PARAGRAPH_SELECT = "paragraph_select"
METHOD_MODEL_FALLBACK = "model_fallback"

TextSelector = Callable[[Path, str, list[dict[str, object]]], dict[str, object] | None]


@dataclass(frozen=True, slots=True)
class TextGroundingConfig:
    """임계값. 환경 변수로 조정할 수 있게 `from_env` 를 둔다."""

    line_threshold: float = 80.0      # 줄·근거 문장 퍼지 점수(0~100) 하한
    coverage_threshold: float = 0.5   # 근거 문장 글자 중 매칭된 줄이 덮는 비율 하한
    min_line_chars: int = 4           # 이보다 짧은 OCR 줄은 우연히 맞기 쉬워 제외
    min_quote_chars: int = 6          # 이보다 짧은 인용은 근거로 쓰지 않는다
    cluster_gap: float = 1.6          # 같은 문단으로 보는 줄 간격(줄 높이 배수)
    pad_ratio: float = 0.7            # 합집합 박스 여백(줄 높이 배수). 버튼 라벨을 컨테이너 크기에 가깝게 한다
    wide_pad_ratio: float = 0.2       # 폭이 화면의 60% 이상인 문단은 여백을 줄인다
    max_candidates: int = 14          # T 후보 수 상한
    apply_confidence: float = 0.5     # 이 신뢰도 이상이면 모델 박스를 대체한다

    @classmethod
    def from_env(cls) -> "TextGroundingConfig":
        defaults = cls()
        def read(name: str, default: float) -> float:
            try:
                return float(os.environ.get(name, default))
            except ValueError:
                return default
        return cls(
            line_threshold=read("DARKAUDIT_TEXT_GROUNDING_LINE_THRESHOLD", defaults.line_threshold),
            coverage_threshold=read("DARKAUDIT_TEXT_GROUNDING_COVERAGE", defaults.coverage_threshold),
        )


@dataclass(frozen=True, slots=True)
class TextCandidate:
    candidate_id: str
    bbox: NormalizedBBox
    text: str
    score: float = 0.0
    sources: tuple[str, ...] = ("ocr-text",)


@dataclass(frozen=True, slots=True)
class TextGroundingResult:
    bbox: NormalizedBBox
    confidence: float
    method: str
    candidate_id: str | None = None
    matched_quote: str | None = None
    score: float = 0.0
    coverage: float = 0.0
    warning: str | None = None
    lines: tuple[str, ...] = field(default_factory=tuple)

    @property
    def usable(self) -> bool:
        return self.method != METHOD_MODEL_FALLBACK


def normalize(value: str) -> str:
    return "".join(re.findall(r"[0-9A-Za-z가-힣]+", value.casefold()))


# ---------------------------------------------------------------- OCR (보강)


def _enhance(image: Image.Image) -> Image.Image:
    """연한 회색 작은 글씨를 진하게 만든 뒤 2배로 키운다."""
    gray = ImageOps.autocontrast(image.convert("L"), cutoff=2)
    binary = gray.point(lambda value: 0 if value < 235 else 255)
    return binary.resize(
        (binary.width * 2, binary.height * 2), Image.Resampling.LANCZOS
    )


def extract_text_anchors(
    image_path: str | Path,
    provider: OCRProvider | None = None,
    base: Sequence[OCRAnchor] | None = None,
) -> list[OCRAnchor]:
    """기본 OCR 줄에 대비 보강 OCR 줄을 합친다.

    보강 OCR 은 두 번 읽는다. 단어 묶음 단위(psm 11)는 나란한 버튼 라벨을 따로 읽고,
    문장 줄 단위(psm 6)는 연한 문단을 한 줄로 읽는다. 문장 줄이 서로 멀리 떨어진 요소를
    한 줄로 합쳐 버린 경우에는 단어 묶음을 남긴다.
    """

    path = Path(image_path)
    anchors = list(base) if base is not None else extract_ocr_anchors(path, provider)
    try:
        with Image.open(path) as source:
            width, height = source.size
            enhanced = _enhance(source)
        with tempfile.TemporaryDirectory(prefix="darkaudit-ocr-") as directory:
            enhanced_path = Path(directory) / "enhanced.png"
            enhanced.save(enhanced_path, format="PNG")
            from .ocr import TesseractOCR, create_ocr_provider

            reader = provider or create_ocr_provider()
            fragments = ocr_result_to_anchors(reader.extract(enhanced_path), enhanced.width, enhanced.height)
            lines: list[OCRAnchor] = []
            if isinstance(reader, TesseractOCR):
                sentence_reader = TesseractOCR(
                    command=reader.command, languages=reader.languages,
                    timeout_seconds=reader.timeout_seconds, psm=6,
                )
                lines = ocr_result_to_anchors(
                    sentence_reader.extract(enhanced_path), enhanced.width, enhanced.height
                )
    except Exception:
        return anchors
    merged = _merge_anchors(anchors, fragments)
    return _integrate_lines(merged, lines, width, height)


def _integrate_lines(
    fragments: Sequence[OCRAnchor],
    lines: Iterable[OCRAnchor],
    width: int,
    height: int,
) -> list[OCRAnchor]:
    """문장 줄(psm 6)을 단어 묶음 위에 얹는다. 서로 멀리 떨어진 묶음을 합친 줄은 버린다."""

    result = list(fragments)
    for line in lines:
        inner = [a for a in result if _overlap_ratio(a.bbox, line.bbox) >= 0.6]
        if not inner:
            result.append(line)
            continue
        # 줄에 일부만 걸친 묶음(옆 버튼 등)까지 포함해 요소 사이 간격을 본다.
        touching = [a for a in result if _overlap_ratio(a.bbox, line.bbox) >= 0.3]
        ordered = sorted(touching, key=lambda a: a.bbox[0])
        line_px = line.bbox[3] * height
        widest_gap = max(
            (
                (right.bbox[0] - (left.bbox[0] + left.bbox[2])) * width
                for left, right in zip(ordered, ordered[1:])
            ),
            default=0.0,
        )
        if widest_gap > 2.5 * line_px:
            continue  # 나란한 요소를 한 줄로 합친 경우: 단어 묶음을 그대로 둔다
        result = [a for a in result if a not in inner]
        result.append(line)
    return result


def _overlap_ratio(inner: NormalizedBBox, outer: NormalizedBBox) -> float:
    """inner 면적 중 outer 와 겹치는 비율."""
    ix = max(0.0, min(inner[0] + inner[2], outer[0] + outer[2]) - max(inner[0], outer[0]))
    iy = max(0.0, min(inner[1] + inner[3], outer[1] + outer[3]) - max(inner[1], outer[1]))
    area = inner[2] * inner[3]
    return (ix * iy) / area if area > 0 else 0.0


def _merge_anchors(base: Sequence[OCRAnchor], extra: Iterable[OCRAnchor]) -> list[OCRAnchor]:
    """기본 OCR 줄과 보강 OCR 줄을 합친다. 한쪽에 60% 이상 포함되는 줄은 큰 쪽만 남긴다."""

    merged = list(base)
    for anchor in extra:
        area = anchor.bbox[2] * anchor.bbox[3]
        swallowed = [
            existing for existing in merged
            if _overlap_ratio(existing.bbox, anchor.bbox) >= 0.6
            and existing.bbox[2] * existing.bbox[3] <= area
        ]
        covered = any(
            _overlap_ratio(anchor.bbox, existing.bbox) >= 0.6
            and existing.bbox[2] * existing.bbox[3] > area
            for existing in merged
        )
        if covered and not swallowed:
            continue
        merged = [existing for existing in merged if existing not in swallowed]
        merged.append(anchor)
    return merged


# ---------------------------------------------------------------- 근거 문장

_QUOTE = re.compile(r"[‘'\"“]([^'\"’”]{4,}?)[’'\"”]")


def finding_quotes(
    observation: str | None,
    what: str | None = None,
    element: str | None = None,
    *,
    min_chars: int = 6,
) -> list[str]:
    """모델이 인용한 화면 문구. 인용부호 안의 문장을 우선하고, 없으면 element 를 쓴다."""

    quotes: list[str] = []
    for text in (observation, what):
        for match in _QUOTE.findall(text or ""):
            quote = match.strip()
            if len(normalize(quote)) >= min_chars and quote not in quotes:
                quotes.append(quote)
    element_text = (element or "").strip()
    element_norm = normalize(element_text)
    if quotes and len(element_norm) >= 4:
        # DA-12 처럼 element 가 화면 문구 그대로면, 대립 선택지 등 다른 인용을 섞지 않는다.
        aligned = [q for q in quotes if fuzz.partial_ratio(element_norm, normalize(q)) >= 80]
        if aligned:
            return aligned
    if not quotes and len(element_norm) >= min_chars:
        quotes.append(element_text)
    return sorted(quotes, key=lambda q: -len(normalize(q)))


@dataclass(frozen=True, slots=True)
class _Match:
    anchors: tuple[OCRAnchor, ...]
    score: float
    coverage: float


def _median_height(anchors: Sequence[OCRAnchor]) -> float:
    return median(anchor.bbox[3] for anchor in anchors) if anchors else 0.0


def _trim_to_quote(anchor: OCRAnchor, text: str, target: str, enabled: bool = True) -> OCRAnchor:
    """줄이 인용문보다 훨씬 길면(옆 글자·잡음이 붙은 줄) 인용문에 해당하는 가로 구간만 남긴다."""

    if not enabled or len(text) <= len(target) * 1.2:
        return anchor
    alignment = fuzz.partial_ratio_alignment(target, text)
    if alignment is None:
        return anchor
    start = max(0, alignment.dest_start - 1)
    end = min(len(text), alignment.dest_end + 1)
    if end <= start:
        return anchor
    left, top, width, height = anchor.bbox
    return OCRAnchor(
        anchor.text,
        (left + width * start / len(text), top, width * (end - start) / len(text), height),
        anchor.confidence,
    )


def match_quote(
    quote: str,
    anchors: Sequence[OCRAnchor],
    config: TextGroundingConfig,
    *,
    trim: bool = False,
) -> _Match | None:
    """근거 문장과 가장 잘 맞는 인접 OCR 줄 묶음을 찾는다."""

    target = normalize(quote)
    if len(target) < config.min_quote_chars:
        return None
    matched: list[tuple[OCRAnchor, float, int]] = []
    for anchor in anchors:
        text = normalize(anchor.text)
        if len(text) < config.min_line_chars:
            continue
        score = fuzz.partial_ratio(text, target)
        if score >= config.line_threshold:
            matched.append((_trim_to_quote(anchor, text, target, trim), score, min(len(text), len(target))))
    if not matched:
        return None

    matched.sort(key=lambda item: (round(item[0].bbox[1], 3), item[0].bbox[0]))
    height = _median_height([anchor for anchor, _, _ in matched]) or 0.01
    clusters: list[list[tuple[OCRAnchor, float, int]]] = [[matched[0]]]
    for item in matched[1:]:
        previous = clusters[-1][-1][0]
        gap = item[0].bbox[1] - (previous.bbox[1] + previous.bbox[3])
        if gap <= config.cluster_gap * height:
            clusters[-1].append(item)
        else:
            clusters.append([item])

    best: _Match | None = None
    for cluster in clusters:
        coverage = min(1.0, sum(size for _, _, size in cluster) / len(target))
        score = sum(value for _, value, _ in cluster) / len(cluster)
        candidate = _Match(tuple(anchor for anchor, _, _ in cluster), score, coverage)
        if best is None or (candidate.coverage, candidate.score) > (best.coverage, best.score):
            best = candidate
    if best is None or best.coverage < config.coverage_threshold:
        return None
    return best


def expand_to_paragraph(
    matched: Sequence[OCRAnchor],
    anchors: Sequence[OCRAnchor],
    config: TextGroundingConfig,
) -> list[OCRAnchor]:
    """인용문이 문단의 일부만 담는 경우, 바로 위·아래의 같은 문단 줄을 더한다.

    줄 높이가 비슷하고(0.7~1.4배), 간격이 줄 높이 이내이며, 왼쪽 또는 가운데가 정렬된 줄만 더한다.
    같은 행의 다른 요소(옆 버튼 등)는 겹치는 세로 범위 때문에 더해지지 않는다.
    """

    group = list(matched)
    pool = [
        a for a in anchors
        if a not in group and len(normalize(a.text)) >= 2 and a.confidence >= 0.3
    ]
    changed = True
    while changed and pool:
        changed = False
        top = min(a.bbox[1] for a in group)
        bottom = max(a.bbox[1] + a.bbox[3] for a in group)
        height = _median_height(group) or 0.01
        for candidate in list(pool):
            ratio = candidate.bbox[3] / height
            below = candidate.bbox[1] - bottom
            above = top - (candidate.bbox[1] + candidate.bbox[3])
            adjacent = (-0.2 * height <= below <= height) or (-0.2 * height <= above <= height)
            if not (0.7 <= ratio <= 1.4 and adjacent):
                continue
            reference = min(
                group,
                key=lambda a: min(abs(candidate.bbox[1] - (a.bbox[1] + a.bbox[3])),
                                  abs(a.bbox[1] - (candidate.bbox[1] + candidate.bbox[3]))),
            )
            left_aligned = abs(candidate.bbox[0] - reference.bbox[0]) <= 0.03
            center_aligned = abs(
                (candidate.bbox[0] + candidate.bbox[2] / 2) - (reference.bbox[0] + reference.bbox[2] / 2)
            ) <= 0.03
            if left_aligned or center_aligned:
                group.append(candidate)
                pool.remove(candidate)
                changed = True
    return group


def union_bbox(
    anchors: Sequence[OCRAnchor],
    width: int,
    height: int,
    config: TextGroundingConfig,
) -> NormalizedBBox:
    """줄 박스의 합집합에 여백을 더한다. 짧은 라벨은 버튼 컨테이너에 가깝게 넓힌다."""

    left = min(anchor.bbox[0] for anchor in anchors)
    top = min(anchor.bbox[1] for anchor in anchors)
    right = max(anchor.bbox[0] + anchor.bbox[2] for anchor in anchors)
    bottom = max(anchor.bbox[1] + anchor.bbox[3] for anchor in anchors)
    line_px = _median_height(anchors) * height
    ratio = config.wide_pad_ratio if (right - left) >= 0.6 else config.pad_ratio
    pad_x = ratio * line_px / max(1, width)
    pad_y = ratio * line_px / max(1, height)
    left, top = max(0.0, left - pad_x), max(0.0, top - pad_y)
    right, bottom = min(1.0, right + pad_x), min(1.0, bottom + pad_y)
    return (round(left, 6), round(top, 6), round(right - left, 6), round(bottom - top, 6))


# ---------------------------------------------------------------- T 후보(문단)


def build_text_candidates(
    anchors: Sequence[OCRAnchor],
    config: TextGroundingConfig,
    *,
    top_margin: float = 0.05,
    image_size: tuple[int, int] = (390, 844),
) -> list[TextCandidate]:
    """읽기 순서의 OCR 줄을 가까운 것끼리 문단으로 묶어 T1..Tn 후보를 만든다."""

    lines = [
        anchor
        for anchor in anchors
        if len(normalize(anchor.text)) >= 2
        and anchor.confidence >= 0.3
        and anchor.bbox[1] >= top_margin
    ]
    if not lines:
        return []
    height = _median_height(lines) or 0.01
    lines.sort(key=lambda anchor: (round(anchor.bbox[1] + anchor.bbox[3] / 2, 3), anchor.bbox[0]))

    # 같은 행(중심 y 가 가까움)의 줄은 한 행으로 합친다.
    rows: list[list[OCRAnchor]] = []
    for anchor in lines:
        center = anchor.bbox[1] + anchor.bbox[3] / 2
        if rows:
            row_center = sum(a.bbox[1] + a.bbox[3] / 2 for a in rows[-1]) / len(rows[-1])
            row_height = max(a.bbox[3] for a in rows[-1])
            gap_x = anchor.bbox[0] - max(a.bbox[0] + a.bbox[2] for a in rows[-1])
            # 같은 행이라도 가로로 멀리 떨어진 라벨(예: 양쪽 버튼)은 서로 다른 후보다.
            near_x = gap_x * image_size[0] <= 2.0 * max(row_height, anchor.bbox[3]) * image_size[1]
            if abs(center - row_center) <= 0.6 * max(row_height, anchor.bbox[3]) and near_x:
                rows[-1].append(anchor)
                continue
        rows.append([anchor])

    # 간격이 좁고 왼쪽 정렬이 비슷한 행은 한 문단으로 합친다.
    paragraphs: list[list[list[OCRAnchor]]] = []
    for row in rows:
        row_left = min(a.bbox[0] for a in row)
        row_top = min(a.bbox[1] for a in row)
        if paragraphs:
            last = paragraphs[-1][-1]
            last_bottom = max(a.bbox[1] + a.bbox[3] for a in last)
            last_left = min(a.bbox[0] for a in last)
            if row_top - last_bottom <= config.cluster_gap * height and abs(row_left - last_left) <= 0.06:
                paragraphs[-1].append(row)
                continue
        paragraphs.append([row])

    candidates: list[TextCandidate] = []
    for index, paragraph in enumerate(paragraphs[: config.max_candidates], 1):
        flat = [anchor for row in paragraph for anchor in row]
        left = min(a.bbox[0] for a in flat)
        top = min(a.bbox[1] for a in flat)
        right = max(a.bbox[0] + a.bbox[2] for a in flat)
        bottom = max(a.bbox[1] + a.bbox[3] for a in flat)
        candidates.append(TextCandidate(
            candidate_id=f"T{index}",
            bbox=(round(left, 6), round(top, 6), round(right - left, 6), round(bottom - top, 6)),
            text=" ".join(a.text for row in paragraph for a in row)[:120],
        ))
    return candidates


# ---------------------------------------------------------------- 진입점


def ground_text_finding(
    image_path: str | Path,
    model_bbox: NormalizedBBox,
    *,
    quotes: Sequence[str],
    evidence_text: str,
    anchors: Sequence[OCRAnchor],
    rule_id: str,
    selector: TextSelector | None = None,
    config: TextGroundingConfig | None = None,
) -> TextGroundingResult:
    """근거 문장으로 박스를 찾고, 실패하면 T 후보 선택, 그래도 안 되면 모델 박스를 돌려준다."""

    config = config or TextGroundingConfig()
    path = Path(image_path)
    try:
        with Image.open(path) as source:
            width, height = source.size
    except (OSError, ValueError):
        return TextGroundingResult(model_bbox, 0.0, METHOD_MODEL_FALLBACK, warning="image_unreadable")

    best: tuple[_Match, str] | None = None
    for quote in quotes:
        found = match_quote(quote, anchors, config, trim=rule_id == "DA-12")
        if found and (best is None or (found.coverage, found.score) > (best[0].coverage, best[0].score)):
            best = (found, quote)
    if best is not None:
        found, quote = best
        confidence = min(0.92, 0.5 + 0.4 * found.coverage * (found.score / 100))
        expanded = expand_to_paragraph(found.anchors, anchors, config)
        return TextGroundingResult(
            union_bbox(expanded, width, height, config),
            confidence,
            METHOD_OCR_FUZZY,
            matched_quote=quote,
            score=round(found.score, 1),
            coverage=round(found.coverage, 2),
            lines=tuple(anchor.text for anchor in expanded),
        )

    candidates = build_text_candidates(anchors, config, image_size=(width, height))
    if selector is None or not candidates:
        return TextGroundingResult(
            model_bbox, 0.0, METHOD_MODEL_FALLBACK,
            warning="text_match_failed" if candidates else "no_ocr_text",
        )
    with tempfile.TemporaryDirectory(prefix="darkaudit-text-grounding-") as directory:
        marked_path = Path(directory) / "text_candidates.png"
        with Image.open(path) as source:
            _draw_marked_crop(source.convert("RGB"), (0, 0, width, height), candidates, marked_path)
        payload = [
            {
                "candidate_id": item.candidate_id,
                "rule_id": rule_id,
                "kind": "text_paragraph",
                "text": item.text,
            }
            for item in candidates
        ]
        try:
            decision = selector(marked_path, evidence_text, payload)
        except Exception as exc:
            return TextGroundingResult(
                model_bbox, 0.0, METHOD_MODEL_FALLBACK,
                warning=f"text_selection_failed:{type(exc).__name__}",
            )
    requested = str((decision or {}).get("selected_candidate_id") or "")
    chosen = next((item for item in candidates if item.candidate_id == requested), None)
    if chosen is None:
        return TextGroundingResult(
            model_bbox, 0.0, METHOD_MODEL_FALLBACK,
            warning="text_selection_none" if requested in {"", "NONE"} else "text_selection_invalid",
        )
    raw_confidence = (decision or {}).get("semantic_confidence", 0.0)
    confidence = (
        min(1.0, max(0.0, float(raw_confidence)))
        if isinstance(raw_confidence, (int, float)) and not isinstance(raw_confidence, bool)
        else 0.0
    )
    return TextGroundingResult(
        chosen.bbox,
        confidence,
        METHOD_PARAGRAPH_SELECT,
        candidate_id=chosen.candidate_id,
    )
