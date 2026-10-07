"""README STEP 이미지에 파란 테두리와 번호 배지를 얹은 사본(*-marked.png)을 만든다.

원본 캡처(docs/images/readme/<name>.png)는 그대로 두고, marks.json의 좌표로
docs/images/readme/<name>-marked.png를 새로 만든다. 배지에는 번호만 넣고 설명
글자는 넣지 않는다. 번호는 README 번호 목록과 같다.

실행(이 폴더에서): python marks.py
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright
from PIL import Image

HERE = Path(__file__).resolve().parent
IMAGES = HERE.parent.parent.parent / "images" / "readme"
BLUE = "#2563EB"
PAD = 14  # 대상 요소 바깥으로 띄우는 여백(px)
BORDER = 6
BADGE = 60  # 배지 지름(px)
RING = 6  # 배지 흰 테두리(px)


def page_html(name: str, width: int, height: int, marks: list[dict]) -> str:
    edge = BADGE // 2 + RING
    parts = []
    for mark in marks:
        left, top, right, bottom = mark["box"]
        x0, y0 = max(0, left - PAD), max(0, top - PAD)
        x1, y1 = min(width, right + PAD), min(height, bottom + PAD)
        parts.append(
            f'<div class="hl" style="left:{x0}px;top:{y0}px;width:{x1 - x0}px;height:{y1 - y0}px"></div>'
        )
        cx = x0 if mark["anchor"] == "tl" else x1
        cx = min(max(cx, edge), width - edge)
        cy = min(max(y0, edge), height - edge)
        parts.append(
            f'<b style="left:{cx - BADGE // 2}px;top:{cy - BADGE // 2}px">{mark["n"]}</b>'
        )
    fonts = HERE.parent.as_uri()
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:J;src:url({fonts}/plus-jakarta-sans-latin-800-normal.woff2);font-weight:800}}
*{{margin:0;padding:0;box-sizing:border-box}}
#c{{position:relative;width:{width}px;height:{height}px}}
#c img{{display:block;width:{width}px;height:{height}px}}
.hl{{position:absolute;border:{BORDER}px solid {BLUE};border-radius:16px;background:rgba(37,99,235,.05)}}
b{{position:absolute;width:{BADGE}px;height:{BADGE}px;border-radius:50%;background:{BLUE};color:#fff;
  font:800 32px/1 J,sans-serif;display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 {RING}px #fff,0 2px 10px {RING}px rgba(20,27,52,.18)}}
</style></head><body><div id="c"><img src="{(IMAGES / f"{name}.png").as_uri()}">{"".join(parts)}</div></body></html>"""


def main() -> None:
    spec = json.loads((HERE / "marks.json").read_text(encoding="utf-8"))["images"]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, marks in spec.items():
            width, height = Image.open(IMAGES / f"{name}.png").size
            page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
            html = HERE / f".{name}.html"
            html.write_text(page_html(name, width, height, marks), encoding="utf-8")
            page.goto(html.as_uri())
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(300)
            out = IMAGES / f"{name}-marked.png"
            page.locator("#c").screenshot(path=str(out))
            html.unlink()
            print(out.name, width, "x", height, os.path.getsize(out))
            page.close()
        browser.close()


if __name__ == "__main__":
    main()
