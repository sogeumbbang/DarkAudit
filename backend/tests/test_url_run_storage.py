from unittest.mock import patch

from PIL import Image

from ai.browser.models import CaptureArtifact, CaptureResult, ScanMode
from ai.browser.profiles import get_device_profile
from ai.pipeline.web_audit import URLCaptureResult
from backend.api import service
from backend.tests.support import IsolatedApiTestCase


class UrlRunStorageTest(IsolatedApiTestCase):
    def test_recheck_keeps_original_capture_bytes_and_urls(self):
        aid = self.client.post("/api/v1/audits", json={
            "name": "URL recheck", "platform": "mobile-web",
        }).json()["id"]
        runs = []

        def capture(pipeline, *, audit_id, url, profiles, mode, goal):
            browser = pipeline.explorer.session_factory(audit_id, get_device_profile("mobile"))
            browser.output_dir.mkdir(parents=True, exist_ok=True)
            path = browser.output_dir / "mobile_00.png"
            Image.new("RGB", (390, 844), "red" if not runs else "blue").save(path)
            runs.append(path)
            artifact = CaptureArtifact(
                "mobile_00", "initial", "mobile", url, "Demo", path, 390, 844,
            )
            return URLCaptureResult(audit_id, url, mode, (CaptureResult(
                audit_id, "mobile", mode, (artifact,), "quick capture completed",
            ),))

        responses = []
        with patch("backend.api.main.UrlSafetyPolicy.validate"), patch(
            "backend.api.service.URLCapturePipeline.run", new=capture,
        ):
            for _ in range(2):
                queued = self.client.post(f"/api/v1/audits/{aid}/capture", json={
                    "url": "https://example.com", "profiles": ["mobile"], "mode": "quick",
                })
                self.assertEqual(queued.status_code, 202, queued.text)
                job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
                self.assertEqual(job["status"], "completed", job)
                audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
                responses.append(audit["screens"][0]["imageUrl"])

        self.assertNotEqual(responses[0], responses[1])
        self.assertNotEqual(runs[0], runs[1])
        with Image.open(runs[0]) as original, Image.open(runs[1]) as revised:
            self.assertEqual(original.getpixel((0, 0)), (255, 0, 0))
            self.assertEqual(revised.getpixel((0, 0)), (0, 0, 255))
        self.assertEqual(self.client.get(responses[0]).content, runs[0].read_bytes())
        self.assertEqual(self.client.get(responses[1]).content, runs[1].read_bytes())

    def test_health_identifies_deployed_commit_without_secrets(self):
        with patch.dict("os.environ", {"RENDER_GIT_COMMIT": "abc123", "OPENAI_API_KEY": "secret"}):
            self.assertEqual(self.client.get("/health").json(), {"status": "ok", "commit": "abc123"})
