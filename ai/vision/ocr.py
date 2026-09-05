"""OCR providers used by screenshot analysis.

Bounding boxes are pixel ``(x, y, width, height)`` values in the source image.
The default provider uses the Tesseract binary installed by the production
image, while keeping ``NullOCR`` available for explicitly disabled OCR.
"""

from __future__ import annotations

import csv
import io
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from PIL import Image


@dataclass(slots=True)
class OCRTextBlock:
    text: str
    bbox: tuple[int, int, int, int] | None = None
    confidence: float = 1.0


@dataclass(slots=True)
class OCRResult:
    blocks: list[OCRTextBlock] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(block.text for block in self.blocks)


class OCRProvider(Protocol):
    def extract(self, image_path: Path) -> OCRResult: ...


class NullOCR:
    """Explicit no-op provider for tests and ``DARKAUDIT_OCR_PROVIDER=none``."""

    def extract(self, image_path: Path) -> OCRResult:
        if not image_path.exists():
            raise FileNotFoundError(image_path)
        return OCRResult()


class TesseractOCR:
    """Extract Korean/English line text and geometry from Tesseract TSV."""

    def __init__(
        self,
        command: str | None = None,
        languages: str | None = None,
        timeout_seconds: float = 20,
    ) -> None:
        self.command = command or os.getenv("DARKAUDIT_TESSERACT_COMMAND", "tesseract")
        self.languages = languages or os.getenv("DARKAUDIT_TESSERACT_LANG", "kor+eng")
        self.timeout_seconds = timeout_seconds

    def extract(self, image_path: Path) -> OCRResult:
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(path)
        # Opening the image here catches corrupt uploads before starting a child
        # process and also guarantees non-zero normalization dimensions upstream.
        with Image.open(path) as image:
            image.verify()
        try:
            completed = subprocess.run(
                [
                    self.command,
                    str(path),
                    "stdout",
                    "-l",
                    self.languages,
                    "--psm",
                    "11",
                    "tsv",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
        except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
            # OCR is a grounding signal, never a reason to fail an audit.
            return OCRResult()
        if completed.returncode != 0:
            return OCRResult()
        return OCRResult(_parse_tesseract_lines(completed.stdout))


def _parse_tesseract_lines(payload: str) -> list[OCRTextBlock]:
    groups: dict[tuple[str, str, str, str], list[dict[str, object]]] = {}
    for row in csv.DictReader(io.StringIO(payload), delimiter="\t"):
        text = (row.get("text") or "").strip()
        try:
            confidence = float(row.get("conf") or -1)
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
        except (TypeError, ValueError):
            continue
        if not text or confidence < 0 or width <= 0 or height <= 0:
            continue
        key = tuple(
            row.get(name) or "0"
            for name in ("page_num", "block_num", "par_num", "line_num")
        )
        groups.setdefault(key, []).append({
            "text": text,
            "confidence": confidence,
            "left": left,
            "top": top,
            "right": left + width,
            "bottom": top + height,
        })

    blocks: list[OCRTextBlock] = []
    for words in groups.values():
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        right = max(int(word["right"]) for word in words)
        bottom = max(int(word["bottom"]) for word in words)
        blocks.append(OCRTextBlock(
            text=" ".join(str(word["text"]) for word in words),
            bbox=(left, top, right - left, bottom - top),
            confidence=sum(float(word["confidence"]) for word in words)
            / (100 * len(words)),
        ))
    return blocks


def create_ocr_provider() -> OCRProvider:
    """Create the configured OCR provider; production defaults to Tesseract."""

    provider = os.getenv("DARKAUDIT_OCR_PROVIDER", "tesseract").strip().casefold()
    if provider in {"", "tesseract", "auto"}:
        return TesseractOCR()
    if provider in {"none", "null", "disabled"}:
        return NullOCR()
    raise ValueError(f"Unsupported DARKAUDIT_OCR_PROVIDER: {provider}")
