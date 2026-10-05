from tempfile import TemporaryDirectory
from unittest.mock import patch

from ai.browser.playwright_driver import PlaywrightSessionFactory
from ai.browser.profiles import get_device_profile
from ai.browser.safety import UnsafeUrlError, UrlSafetyPolicy
from backend.api.demo_browser import bundled_demo_policy
from backend.tests.support import IsolatedApiTestCase

PRESET = {"source": "website", "scenario": "travel"}
URL = "http://127.0.0.1:65530/demo/web/index.html?scenario=travel&variant=risky&step=1"


class LocalDemoBrowserTest(IsolatedApiTestCase):
    def test_only_owned_builtin_demo_is_accepted_for_local_capture(self):
        for preset, url, expected in (
            (PRESET, URL, 202),
            (None, URL, 400),
            (PRESET, "http://127.0.0.1:8000/api/v1/dashboard/summary", 400),
            (PRESET, URL.replace("scenario=travel", "scenario=pet"), 400),
            (PRESET, URL.replace("step=1", "step=9"), 400),
        ):
            with self.subTest(preset=preset, url=url):
                audit_id = self.client.post("/api/v1/audits", json={
                    "name": "Local demo", "platform": "mobile-web", "demoPreset": preset,
                }).json()["id"]
                with patch("backend.api.main.capture_and_analyze_url") as capture:
                    response = self.client.post(f"/api/v1/audits/{audit_id}/capture", json={
                        "url": url, "mode": "quick", "profiles": ["mobile"], "demoVariant": "risky",
                    })
                self.assertEqual(response.status_code, expected, response.text)
                self.assertEqual(capture.called, expected == 202)

    def test_browser_runs_all_six_steps_without_a_local_http_server(self):
        policy = bundled_demo_policy(URL, PRESET, "risky")
        with TemporaryDirectory() as directory:
            factory = PlaywrightSessionFactory(directory, url_policy=policy,
                static_routes=policy.assets, settle_time_ms=0)
            with factory("demo", get_device_profile("mobile")) as browser:
                first = browser.start(URL)
                self.assertTrue(first.image_path.is_file())
                self.assertTrue(first.dom_elements)
                for step in range(2, 7):
                    browser._page.locator("[data-next]").first.click()
                    browser._page.wait_for_url(f"**&step={step}")
                    frame = browser.capture(f"step {step}")
                    self.assertIn(f"step={step}", frame.url)
                # Even requests to the same origin's API cannot escape to the network.
                self.assertTrue(browser._page.evaluate("async () => { try { await fetch('/api/v1/demo-inputs'); return false; } catch { return true; } }"))
        with self.assertRaises(UnsafeUrlError):
            UrlSafetyPolicy().validate(URL)
