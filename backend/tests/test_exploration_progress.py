from unittest.mock import patch

from PIL import Image

from ai.browser.models import ExplorationEvent
from ai.tests.test_browser_explorer import FakeAgent, FakeSession
from backend.api import service, jobs
from backend.tests.support import IsolatedApiTestCase


class ImageSession(FakeSession):
    def _artifact(self, *args, **kwargs):
        artifact = super()._artifact(*args, **kwargs)
        Image.new("RGB", (artifact.viewport_width, artifact.viewport_height), "white").save(artifact.image_path)
        return artifact


class ExplorationProgressTest(IsolatedApiTestCase):
    def test_real_pipeline_exposes_frames_during_capture_and_retains_them_on_failure(self):
        audit_id = self.client.post("/api/v1/audits", json={"name": "Live", "platform": "mobile-web"}).json()["id"]
        observations = []
        test_case = self

        class ObservingAgent(FakeAgent):
            def begin(self, goal):
                job_id = jobs.latest(service.DATA_DIR, audit_id)
                snapshot = service.get_job(job_id)
                observations.append(snapshot)
                test_case.assertEqual(snapshot.explorationStage, "capturing")
                test_case.assertEqual(len(snapshot.explorationEvents), 1)
                public_job = test_case.client.get(f"/api/v1/analysis-jobs/{job_id}").json()
                image = test_case.client.get(public_job["explorationEvents"][0]["imageUrl"])
                test_case.assertEqual(image.status_code, 200)
                return super().begin(goal)

        with (
            patch.dict("os.environ", {"DARKAUDIT_COMPUTER_MODEL": "test"}),
            patch("backend.api.main.UrlSafetyPolicy.validate", return_value="https://example.com"),
            patch("backend.api.service.OpenAIComputerUseAgent", return_value=ObservingAgent()),
            patch("backend.api.service.PlaywrightSessionFactory", return_value=lambda audit, profile: ImageSession(service.CAPTURE_DIR, profile)),
            patch("backend.api.service.create_provider", side_effect=ValueError("analysis unavailable")),
        ):
            response = self.client.post(f"/api/v1/audits/{audit_id}/capture", json={
                "url": "https://example.com", "mode": "smart", "profiles": ["mobile"],
            })
        self.assertEqual(response.status_code, 202, response.text)
        status = self.client.get("/api/v1/analysis-jobs/" + response.json()["jobId"]).json()
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["explorationStage"], "failed")
        self.assertEqual(status["explorationMode"], "smart")
        events = status["explorationEvents"]
        self.assertEqual([e["kind"] for e in events], ["capture", "action", "result", "capture", "complete"])
        self.assertEqual(events[1]["imageUrl"], events[0]["imageUrl"])
        self.assertNotEqual(events[2]["imageUrl"], events[1]["imageUrl"])
        self.assertAlmostEqual(events[1]["x"], 100 / events[1]["width"])
        self.assertEqual(len(observations[0].explorationEvents), 1)
        self.assertNotIn("imagePath", str(events))

    def test_event_buffer_is_bounded_with_stable_increasing_ids(self):
        from ai.browser.profiles import get_device_profile

        job = service.create_job("audit", 1)
        session = ImageSession(service.CAPTURE_DIR, get_device_profile("mobile"))
        artifact = session.start("https://example.com")
        for _ in range(245):
            service._record_exploration(job.jobId, ExplorationEvent("capture", artifact))
        events = service.get_job(job.jobId).explorationEvents
        self.assertEqual(len(events), 240)
        self.assertEqual(events[0].id, 6)
        self.assertEqual(events[-1].id, 245)
