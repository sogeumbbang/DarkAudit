"""펫보험 데모(모루)의 수정본 화면 6장을 렌더링한다.

원본(`frontend/public/sample-audit/`)과 같은 데모 페이지·같은 렌더링 설정(393x852, 2배)을 쓰고,
시연용 다크패턴 두 가지만 고친다. 데모 원본 파일은 수정하지 않고, 렌더링 중에
`scenarios.js` 응답에 패치를 덧붙여 장면 데이터를 바꾼다.

  - DA-04: 선택 특약 2개와 광고 수신 동의를 미선택 상태로 둔다. 최종 금액은 데모 페이지가
           선택 상태에 따라 계산한다(기본 보험료 12,900 + 필수 계약 관리비 1,100 = 14,000).
  - DA-15: 필수 계약 관리비 1,100원을 1단계 금액(월 이용료 총액)에 처음부터 포함해 14,000원으로
           표시하고, 혜택 목록의 세 번째 항목(모바일 간편 청구)을 "필수 계약 관리비 1,100원 포함"으로 바꾼다.
  - DA-04(3단계): 개인정보·광고 수신 동의 화면의 혜택 목록 체크 모양(✓)이 "선택된 동의 항목"으로 읽혀
           (모델이 사전선택으로 판정) 점(•)으로 바꾼다. 동의는 어느 것도 선택된 상태가 아니다.
  - 일관성: 5단계의 "선택한 특약 2개 포함"은 특약이 없으므로 "선택한 특약 없음 (기본형)"으로 바꾼다.
  - DA-03·DA-07·DA-12 연출(버튼 위계, 작은 면책 문구, 죄책감 문구)은 원본과 같게 둔다.

실행: python demo/render_revised_pet.py   (Playwright + Pillow 필요, 네트워크 불필요)
결과: frontend/public/sample-audit-revised/{01-product-intro … 06-final-price}.png
"""

from __future__ import annotations

import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "frontend/public/dark-pattern-demo"
OUT = ROOT / "frontend/public/sample-audit-revised"
NAMES = [
    "01-product-intro",
    "02-preselected-addon",
    "03-consent-pressure",
    "04-emotional-pressure",
    "05-hidden-conditions",
    "06-final-price",
]

PATCH = """
;(() => {
  const [offer, options, , , conditions] = window.DEMO_SCENARIOS.pet.steps;
  offer.amount = "14,000";
  // 한 줄을 더하면 화면이 852px 를 넘으므로 세 번째 혜택(모바일 간편 청구)을 포함 내역 안내로 바꾼다.
  offer.features = offer.features.map((item) =>
    item === "모바일 간편 청구" ? "필수 계약 관리비 1,100원 포함" : item);
  options.options = options.options.map(([title, detail]) => [title, detail, false]);
  conditions.features = conditions.features.map((item) =>
    item === "선택한 특약 2개 포함" ? "선택한 특약 없음 (기본형)" : item);
})();
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - 서버 로그를 조용히
        pass


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(WEB)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    original_scenarios = (WEB / "scenarios.js").read_text(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)

    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(channel="chrome", headless=True)
            except Exception:  # Chrome 이 없으면 번들 Chromium 으로 대신한다.
                browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.route(
                "**/scenarios.js",
                lambda route: route.fulfill(
                    status=200, content_type="text/javascript", body=original_scenarios + PATCH
                ),
            )
            page.goto(f"{base}/index.html?scenario=pet")
            for step in range(1, 7):
                page.wait_for_function("document.querySelector('h1') !== null")
                page.evaluate("document.fonts.ready")
                geometry = page.evaluate(
                    "({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})"
                )
                assert geometry == {"width": 393, "height": 852}, (step, geometry)
                if step == 3:
                    page.evaluate("document.querySelectorAll('.tick').forEach((el) => { el.textContent = '•'; })")
                page.screenshot(path=str(OUT / f"{NAMES[step - 1]}.png"))
                if step == 2:
                    checked = page.locator("[data-option]:checked").count()
                    assert checked == 0, f"선택 특약이 미선택 상태가 아니다: {checked}"
                if step == 6:
                    total = page.locator(".receipt-total").inner_text()
                    assert "14,000" in total, total
                if step < 6:
                    page.locator("[data-next]").first.click()
                    page.wait_for_url(f"**step={step + 1}")
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f"수정본 6장을 {OUT.relative_to(ROOT)} 에 저장했다.")


if __name__ == "__main__":
    main()
