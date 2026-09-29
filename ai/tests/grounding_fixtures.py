"""Deterministic evidence images, independent of the editable frontend demo.

Draw known control geometry into temporary files so tests do not depend on
browser rendering, installed fonts, or changes to sample-audit screenshots.
"""

from pathlib import Path

from PIL import Image, ImageDraw


def write_grounding_screens(directory: Path, scale: int = 1) -> tuple[Path, Path]:
    size = (390 * scale, 844 * scale)

    def bounds(x: int, y: int, width: int, height: int) -> tuple[int, int, int, int]:
        # Pillow includes the right and bottom pixels of a rectangle.
        return (x * scale, y * scale, (x + width) * scale - 1, (y + height) * scale - 1)

    option = Image.new("RGB", size, "#ffffff")
    draw = ImageDraw.Draw(option)
    draw.rounded_rectangle(
        bounds(24, 244, 342, 228), radius=12 * scale,
        fill="#f5f6f7", outline="#d1d5db", width=scale,
    )
    draw.rounded_rectangle(bounds(44, 292, 28, 28), radius=4 * scale, fill="#166f51")
    draw.line(
        [(50 * scale, 306 * scale), (56 * scale, 312 * scale), (66 * scale, 300 * scale)],
        fill="white", width=3 * scale,
    )
    draw.rectangle(bounds(90, 298, 204, 8), fill="#444444")
    draw.rectangle(bounds(90, 324, 140, 6), fill="#888888")
    # An unchecked alternative and a larger filled button are distractors.
    draw.rounded_rectangle(
        bounds(44, 412, 28, 28), radius=4 * scale, outline="#888888", width=2 * scale,
    )
    draw.rounded_rectangle(bounds(24, 688, 342, 64), radius=10 * scale, fill="#166f51")
    option_path = directory / "02-preselected-addon.png"
    option.save(option_path)

    consent = Image.new("RGB", size, "#ffffff")
    draw = ImageDraw.Draw(consent)
    draw.rectangle(bounds(24, 580, 200, 12), fill="#444444")
    draw.rounded_rectangle(bounds(24, 688, 342, 64), radius=10 * scale, fill="#166f51")
    draw.rectangle(bounds(105, 714, 180, 10), fill="#ffffff")
    draw.rectangle(bounds(140, 785, 109, 6), fill="#aaaaaa")
    consent_path = directory / "03-consent-pressure.png"
    consent.save(consent_path)
    return option_path, consent_path
