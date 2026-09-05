from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

import httpx

from backend.api.android_runner import (
    AndroidRunnerSettings,
    BrowserStackAndroidRunner,
    _tap_candidates,
)

_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class AndroidTapCandidateTest(unittest.TestCase):
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
