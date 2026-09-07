from __future__ import annotations

import base64
import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import httpx

from backend.api.android_runner import (
    AndroidRunnerError,
    AndroidRunnerSettings,
    BrowserStackAndroidRunner,
    _tap_candidates,
)

_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class AndroidTapCandidateTest(unittest.TestCase):
    def test_default_capture_budget_covers_six_screen_demo_and_stays_bounded(self) -> None:
        with patch.dict(os.environ, {"BROWSERSTACK_USERNAME": "user", "BROWSERSTACK_ACCESS_KEY": "key"}, clear=True):
            self.assertEqual(AndroidRunnerSettings.from_env().max_screens, 6)
            for value, expected in (("1", 1), ("5", 5), ("6", 6), ("100", 6)):
                with patch.dict(os.environ, {"ANDROID_MAX_SCREENS": value}):
                    self.assertEqual(AndroidRunnerSettings.from_env().max_screens, expected)

    def test_screenshot_accepts_wrapped_base64_without_changing_image(self) -> None:
        encoded = base64.b64encode(_TINY_PNG).decode("ascii")
        wrapped = base64.encodebytes(_TINY_PNG).decode("ascii")
        for value in (encoded, wrapped, " \t" + wrapped.replace("\n", "\r\n") + "\t "):
            with self.subTest(value=value):
                with httpx.Client(transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, json={"value": value})
                )) as client:
                    runner = BrowserStackAndroidRunner(AndroidRunnerSettings("user", "key"), client=client)
                    self.assertEqual(runner._screenshot("session"), _TINY_PNG)

    def test_screenshot_still_rejects_invalid_base64(self) -> None:
        encoded = base64.b64encode(_TINY_PNG).decode("ascii")
        for value in (encoded[:20] + "!" + encoded[20:], encoded[:-2], encoded + "가", encoded + "\u00a0"):
            with self.subTest(value=value):
                with httpx.Client(transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, json={"value": value})
                )) as client:
                    runner = BrowserStackAndroidRunner(AndroidRunnerSettings("user", "key"), client=client)
                    with self.assertRaisesRegex(AndroidRunnerError, "응답이 손상"):
                        runner._screenshot("session")

    def test_prefers_safe_navigation_and_blocks_terminal_actions(self) -> None:
        source = """<hierarchy>
          <node clickable="true" enabled="true" text="결제하기" bounds="[0,700][390,780]" />
          <node clickable="true" enabled="true" text="다음" bounds="[0,600][390,680]" />
          <node clickable="true" enabled="true" text="상품 보기" bounds="[0,200][390,280]" />
        </hierarchy>"""
        candidates = _tap_candidates(source, set())
        self.assertEqual([candidate.label for candidate in candidates], ["다음", "상품 보기"])

    def test_does_not_repeat_an_attempted_control(self) -> None:
        source = """<hierarchy>
          <node clickable="true" enabled="true" resource-id="next" text="계속" bounds="[0,600][390,680]" />
        </hierarchy>"""
        first = _tap_candidates(source, set())[0]
        self.assertEqual(_tap_candidates(source, {first.signature}), [])

    def test_reuses_next_button_on_a_new_screen_and_bounds_loops(self) -> None:
        class Runner(BrowserStackAndroidRunner):
            state = 0
            taps = 0
            def _stable_source(self, session_id):
                return (f'<hierarchy><node text="step {self.state}" />'
                        '<node clickable="true" enabled="true" resource-id="next" text="다음" '
                        'bounds="[0,600][390,680]" /></hierarchy>')
            def _screenshot(self, session_id): return _TINY_PNG
            def _tap(self, session_id, x, y):
                self.taps += 1
                self.state += 1

        runner = Runner(AndroidRunnerSettings("user", "key", max_screens=3))
        with tempfile.TemporaryDirectory() as directory:
            captures = runner._explore("session", Path(directory))
        self.assertEqual(len(captures), 3)
        self.assertEqual(runner.taps, 2)
        self.assertEqual(len({c.state_id for c in captures}), 3)

        runner = Runner(AndroidRunnerSettings("user", "key", max_actions=4))
        runner._tap = lambda *args: None
        with tempfile.TemporaryDirectory() as directory:
            captures = runner._explore("session", Path(directory))
        self.assertEqual(len(captures), 1)
        self.assertIn("android_no_safe_navigation", runner.last_warnings)

    def test_goal_affects_safe_navigation_ranking(self) -> None:
        source = ('<hierarchy><node clickable="true" text="상품 보기" bounds="[0,100][390,180]" />'
                  '<node clickable="true" text="보험 보기" bounds="[0,200][390,280]" /></hierarchy>')
        self.assertEqual(_tap_candidates(source, set(), "보험 조건 확인")[0].label, "보험 보기")

    def test_browserstack_capture_uploads_launches_and_stores_screenshot(self) -> None:
        requests: list[tuple[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append((request.method, request.url.path))
            if request.url.path == "/app-automate/upload":
                return httpx.Response(200, json={"app_url": "bs://app-id"})
            if request.method == "POST" and request.url.path.endswith("/session"):
                return httpx.Response(200, json={"value": {"sessionId": "session-id"}})
            if request.url.path.endswith("/screenshot"):
                return httpx.Response(200, json={"value": base64.b64encode(_TINY_PNG).decode()})
            if request.url.path.endswith("/source"):
                return httpx.Response(200, json={"value": "<hierarchy />"})
            if request.method == "DELETE":
                return httpx.Response(200, json={"value": None})
            return httpx.Response(404)

        settings = AndroidRunnerSettings("user", "key", max_screens=2)
        client = httpx.Client(
            auth=(settings.username, settings.access_key),
            transport=httpx.MockTransport(handler),
        )
        runner = BrowserStackAndroidRunner(settings, client=client)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            apk = root / "sample.apk"
            apk.write_bytes(b"PK\x03\x04fake")
            captures = runner.capture(apk, root / "screens", audit_id="audit-1", goal=None)
            self.assertEqual(len(captures), 1)
            self.assertEqual(captures[0].image_path.read_bytes(), _TINY_PNG)

        self.assertIn(("POST", "/app-automate/upload"), requests)
        self.assertIn(("POST", "/wd/hub/session"), requests)
        self.assertIn(("DELETE", "/wd/hub/session/session-id"), requests)


if __name__ == "__main__":
    unittest.main()
