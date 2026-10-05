"""URL demos compare authored steps, independent of Computer Use action counts."""
from dataclasses import replace
from unittest.mock import patch

from PIL import Image

from ai.browser.models import CaptureArtifact, CaptureResult, ScanMode
from ai.pipeline.web_audit import URLCaptureResult
from ai.vision.candidate_grounding import OCRAnchor
from backend.api import service
from backend.api.demo_capture import demo_entry_screens
from backend.tests.support import IsolatedApiTestCase
from backend.tests.test_api import VerifiedAssessmentProvider

PRESET = {"source": "website", "scenario": "travel"}


class DemoCaptureComparisonTest(IsolatedApiTestCase):
    def captures(self, variant, steps=(1, 2, 2, 3, 4, 5, 6)):
        artifacts = []
        for index, step in enumerate(steps):
            path = service.CAPTURE_DIR / f"{variant}-{index}.png"
            Image.new("RGB", (390, 844), "white").save(path)
            artifacts.append(CaptureArtifact(
                f"mobile_{index:02d}", f"mobile: agent step {index}", "mobile",
                self.url(variant, step), "Demo", path, 390, 844,
                state_id=str(index), fingerprint=f"{variant}-{index}",
            ))
        # This retained source repeats the final step; it must not become a
        # seventh comparison screen or replace the first-entry viewport.
        artifacts.append(replace(artifacts[-1], full_page=True, screen_id="mobile_final"))
        return tuple(artifacts)

    @staticmethod
    def url(variant, step=1):
        return f"https://example.com/demo/web/index.html?scenario=travel&variant={variant}&step={step}"

    def test_first_entry_identity_is_stable_across_extra_actions(self):
        original = self.captures("risky")
        revised = self.captures("revised", (1, 1, 2, 3, 3, 4, 5, 6))
        before = demo_entry_screens(original, self.url("risky"), PRESET, "risky")
        after = demo_entry_screens(revised, self.url("revised"), PRESET, "revised")
        self.assertEqual(len(before), 6)
        self.assertEqual([(a.screen_id, a.flow_step, a.path_id, a.state_id) for a in before],
                         [(a.screen_id, a.flow_step, a.path_id, a.state_id) for a in after])
        self.assertEqual(before[1].image_path, original[1].image_path)
        self.assertEqual(after[1].image_path, revised[2].image_path)

    def test_incomplete_foreign_and_non_demo_inputs_are_not_normalized(self):
        original = self.captures("risky")
        for artifacts, preset, variant in (
            (tuple(a for a in original if "step=4" not in a.url), PRESET, "risky"),
            ((replace(original[0], url="https://other.example/demo/web/index.html?step=1"), *original[1:]), PRESET, "risky"),
            (original, None, "risky"),
            (original, PRESET, "revised"),
        ):
            with self.subTest(preset=preset, variant=variant):
                self.assertIsNone(demo_entry_screens(artifacts, self.url("risky"), preset, variant))

    def capture_run(self, audit_id, variant, steps):
        artifacts = self.captures(variant, steps)
        capture = URLCaptureResult(audit_id, self.url(variant), ScanMode.SMART, (
            CaptureResult(audit_id, "mobile", ScanMode.SMART, artifacts,
                          "Computer Use completed exploration"),
        ))
        with (
            patch.dict("os.environ", {"DARKAUDIT_COMPUTER_MODEL": "test"}),
            patch("backend.api.main.UrlSafetyPolicy.validate", return_value=self.url(variant)),
            patch("backend.api.service.OpenAIComputerUseAgent"),
            patch("backend.api.service.URLCapturePipeline.run", return_value=capture),
            patch("backend.api.service.create_provider", return_value=VerifiedAssessmentProvider(variant == "risky")),
            patch("ai.pipeline.baseline.BaselineAuditPipeline._ground_visual_bboxes", lambda self, output, request: (output, [])),
            patch("ai.pipeline.baseline.extract_ocr_anchors", return_value=[OCRAnchor("고정 검증 화면", (0.1, 0.1, 0.8, 0.2), 1.0)]),
        ):
            response = self.client.post(f"/api/v1/audits/{audit_id}/capture", json={
                "url": self.url(variant), "mode": "smart", "profiles": ["mobile"], "demoVariant": variant,
            })
        self.assertEqual(response.status_code, 202, response.text)
        job = self.client.get(f"/api/v1/analysis-jobs/{response.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)

    def new_audit(self):
        return self.client.post("/api/v1/audits", json={
            "name": "URL 데모", "platform": "mobile-web", "demoPreset": PRESET,
        }).json()["id"]

    def test_url_pipeline_verifies_revision_despite_different_click_counts(self):
        audit_id = self.new_audit()
        self.capture_run(audit_id, "risky", (1, 2, 2, 3, 4, 5, 6))
        self.capture_run(audit_id, "revised", (1, 1, 2, 3, 3, 4, 5, 6))
        result = self.client.get(f"/api/v1/audits/{audit_id}/regression").json()
        self.assertEqual(result["comparisonStatus"], "complete", result)
        self.assertEqual(result["resolvedRatio"], 1)
        self.assertEqual([c["ruleId"] for c in result["resolved"]], ["DA-12"])
        self.assertFalse(result["pending"])
        self.assertIn("6개 화면", result["scopeDescription"])
        self.assertTrue(result["resolved"][0]["location"])
        self.assertTrue(result["resolved"][0]["element"])

    def test_missing_demo_step_cannot_be_certified_as_resolved(self):
        audit_id = self.new_audit()
        self.capture_run(audit_id, "risky", (1, 2, 3, 4, 5, 6))
        self.capture_run(audit_id, "revised", (1, 2, 3, 5, 6))
        result = self.client.get(f"/api/v1/audits/{audit_id}/regression").json()
        self.assertEqual(result["comparisonStatus"], "incomplete")
        self.assertFalse(result["resolved"])
        self.assertEqual(len(result["pending"]), 1)
        self.assertTrue(result["pending"][0]["verificationNote"])
