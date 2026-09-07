"""Render authored HTML into six ordered screenshot inputs and review sheets.

Run with Playwright + Pillow installed. No network or external font dependency.
"""
from __future__ import annotations

import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "frontend/public/dark-pattern-demo"
PREVIEWS = ROOT / "demo/previews"
SAMPLES = ROOT / "frontend/public/sample-audit"
NAMES = ["01-product-intro", "02-preselected-addon", "03-consent-pressure", "04-emotional-pressure", "05-hidden-conditions", "06-final-price"]


def main():
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(WEB))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    SAMPLES.mkdir(parents=True, exist_ok=True)
    checks = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            for scenario in ("travel", "pet", "credit"):
                context = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}/index.html?scenario={scenario}")
                images = []
                for step in range(1, 7):
                    page.wait_for_function("document.querySelector('h1') !== null")
                    page.evaluate("document.fonts.ready")
                    title = page.locator("h1").inner_text()
                    geometry = page.evaluate("({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})")
                    assert geometry == {"width": 393, "height": 852}, (scenario, step, geometry)
                    path = PREVIEWS / f"{scenario}-{step:02d}.png"
                    page.screenshot(path=str(path))
                    if scenario == "pet":
                        Image.open(path).save(SAMPLES / f"{NAMES[step-1]}.png")
                    images.append(path)
                    checks.append({"scenario": scenario, "step": step, "title": title, "geometry": geometry})
                    if step < 6:
                        page.locator("[data-next]").first.click()
                        page.wait_for_url(f"**step={step+1}")
                assert not errors, errors
                sheet = Image.new("RGB", (3 * 413 + 20, 2 * 892 + 30), "#e9edf3")
                draw = ImageDraw.Draw(sheet)
                for index, path in enumerate(images):
                    x, y = 20 + (index % 3) * 413, 30 + (index // 3) * 892
                    draw.text((x, y - 17), f"{scenario.upper()} / {index + 1:02d}", fill="#324255")
                    sheet.paste(Image.open(path).convert("RGB").resize((393, 852)), (x, y))
                sheet.save(PREVIEWS / f"{scenario}-overview.png")
                # Choices must affect cost and survive going back.
                if scenario in {"travel", "pet"}:
                    page.goto(f"http://127.0.0.1:{server.server_port}/index.html?scenario={scenario}&step=2")
                    page.locator("[data-option='0']").uncheck()
                    page.locator("[data-next]").first.click()
                    page.wait_for_url("**step=3")
                    page.goto(f"http://127.0.0.1:{server.server_port}/index.html?scenario={scenario}&step=6")
                    assert ("6,400" if scenario == "travel" else "15,800") in page.locator(".receipt-total").inner_text()
                context.close()
            # Small phone layout must also keep navigation in view.
            page = browser.new_page(viewport={"width": 360, "height": 800})
            for scenario in ("travel", "pet", "credit"):
                for step in range(1, 7):
                    page.goto(f"http://127.0.0.1:{server.server_port}/index.html?scenario={scenario}&step={step}")
                    assert page.evaluate("document.documentElement.scrollWidth") == 360
                    assert page.locator("#actions").bounding_box()["y"] < 800
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    (PREVIEWS / "validation.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n")
    print(f"Validated and rendered {len(checks)} screens; six pet PNGs ready.")


if __name__ == "__main__":
    main()
