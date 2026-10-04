"""Build risky/partial/revised demo PNGs and their public catalog from authored HTML."""
import functools
import hashlib
import json
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "frontend/public/dark-pattern-demo"
OUT = ROOT / "frontend/public/demo-cases"
VARIANTS = {"risky": "문제 포함 원본", "partial": "일부 수정본", "revised": "전체 개선본"}
LEGACY = ["01-product-intro", "02-preselected-addon", "03-consent-pressure",
          "04-emotional-pressure", "05-hidden-conditions", "06-final-price"]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(WEB)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks, cases = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            for scenario, product in (("pet", "insurance"), ("travel", "other"), ("credit", "other")):
                case = {"id": scenario, "productType": product, "variants": []}
                for variant, label in VARIANTS.items():
                    context = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
                    page = context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    url = f"http://127.0.0.1:{server.server_port}/index.html?scenario={scenario}&variant={variant}"
                    page.goto(url)
                    case["name"] = page.evaluate("scenario.local")
                    screens = []
                    for step in range(1, 7):
                        page.evaluate("document.fonts.ready")
                        width = page.evaluate("document.documentElement.scrollWidth")
                        assert width == 393, (scenario, variant, step, width)
                        # Capture the whole authored screen if readable terms require more height.
                        target = OUT / scenario / variant / f"{step:02d}.png"
                        target.parent.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(target), full_page=True)
                        screens.append({"fileName": f"{step:02d}.png", "flowStep": page.evaluate("screen.name"),
                                        "url": f"/demo/cases/{scenario}/{variant}/{step:02d}.png",
                                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
                        if step == 2:
                            count = page.locator("[data-option]:checked").count()
                            assert count == (3 if variant == "risky" else 0)
                        if step == 6 and scenario in {"pet", "travel"}:
                            expected = {"pet": ("19,000", "14,000"), "travel": ("8,300", "6,400")}[scenario]
                            assert expected[variant != "risky"] in page.locator(".receipt-total").inner_text()
                        checks.append({"scenario": scenario, "variant": variant, "step": step,
                                       "height": page.evaluate("document.documentElement.scrollHeight")})
                        if step < 6:
                            page.locator("[data-next]").first.click()
                            page.wait_for_url(f"**step={step+1}")
                    assert not errors, errors
                    case["variants"].append({"id": variant, "label": label, "screens": screens,
                        "websiteUrl": f"/demo/web/index.html?scenario={scenario}&variant={variant}&step=1",
                        "expectedRules": ["DA-03", "DA-04", "DA-07", "DA-12", "DA-15"] if variant == "risky"
                            else ["DA-03", "DA-07", "DA-12"] if variant == "partial" else []})
                    context.close()
                cases.append(case)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    for variant, destination in (("risky", ROOT / "frontend/public/sample-audit"),
                                 ("partial", ROOT / "demo/sample-audit-revised")):
        destination.mkdir(parents=True, exist_ok=True)
        for index, name in enumerate(LEGACY, 1):
            shutil.copyfile(OUT / "pet" / variant / f"{index:02d}.png", destination / f"{name}.png")
    catalog = json.dumps({"version": "demo-v3", "cases": cases}, ensure_ascii=False, indent=2) + "\n"
    (OUT / "manifest.json").write_text(catalog)
    (ROOT / "frontend/src/mocks/fixtures/demo-cases.json").write_text(catalog)
    (ROOT / "demo/previews/variants-validation.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n")
    print(f"Rendered {len(checks)} screens across {len(cases)} scenarios and 3 variants.")


if __name__ == "__main__":
    main()
