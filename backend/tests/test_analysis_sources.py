import io
import copy
import zipfile
from unittest.mock import patch

from PIL import Image

from ai.browser.models import CaptureArtifact, CaptureResult, ScanMode
from ai.pipeline.web_audit import URLCaptureResult
from backend.api import service
from backend.api.android_runner import AndroidCapture
from backend.tests.support import IsolatedApiTestCase
from backend.tests.test_figma_paths import document
from backend.tests.test_figma_import import StubFigmaClient
from backend.tests.test_api import DetectingProvider


class AnalysisSourcesTest(IsolatedApiTestCase):
    def test_same_rule_and_wording_on_distinct_elements_are_preserved(self):
        audit_id = self.create_audit()

        class Provider(DetectingProvider):
            def analyze(self, **kwargs):
                raw = super().analyze(**kwargs)
                extra = copy.deepcopy(raw["semantic_findings"][0])
                extra["where"]["element"] = "다른 선택지"
                extra["bbox"] = [0.1, 0.6, 0.05, 0.05]
                raw["semantic_findings"].append(extra)
                return raw

        data = io.BytesIO()
        Image.new("RGB", (400, 800), "white").save(data, format="PNG")
        self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("screen.png", data.getvalue(), "image/png")},
        )
        with patch("backend.api.service.create_provider", return_value=Provider()):
            result = self.result(self.client.post(f"/api/v1/audits/{audit_id}/analyze"))
        self.assertEqual(len(result["findings"]), 2)

    def create_audit(self):
        return self.client.post(
            "/api/v1/audits", json={"name": "검증 흐름", "platform": "mobile-web"}
        ).json()["id"]

    def result(self, job):
        self.assertEqual(job.status_code, 202, job.text)
        status = self.client.get("/api/v1/analysis-jobs/" + job.json()["jobId"]).json()
        self.assertEqual(status["status"], "completed", status)
        summary = self.client.get("/api/v1/dashboard/summary").json()
        return next(a for a in summary["audits"] if a["id"] == job.json()["auditId"])

    def test_figma_rest_branches_reach_common_analyzer_and_persist_quality(self):
        audit_id = self.create_audit()
        with (
            patch.object(StubFigmaClient, "document", document()),
            patch("backend.api.figma_import.FigmaClient", StubFigmaClient),
            patch(
                "backend.api.service.create_provider", return_value=DetectingProvider()
            ),
        ):
            job = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://figma.com/design/abc/Example",
                    "selectionMode": "prototype-flow",
                    "target": "app",
                },
            )
        result = self.result(job)
        self.assertEqual(len(result["screens"]), 4)
        self.assertEqual(
            len(result["findings"]), 1
        )  # shared first-screen evidence is not duplicated
        batches = result["analysisSummary"]["batches"]
        self.assertEqual(
            [b["screens"] for b in batches],
            [["screen-01", "screen-02", "screen-03"], ["screen-01", "screen-04"]],
        )
        self.assertFalse(
            result["analysisSummary"]["complete"]
        )  # stub omits rule assessments

    def test_figma_canvas_order_is_not_price_progression_evidence(self):
        audit_id = self.create_audit()
        states = []
        class Provider(DetectingProvider):
            def analyze(self, **kwargs):
                states.extend(s.state_id for s in kwargs["request"].screens)
                return super().analyze(**kwargs)
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient), patch(
            "backend.api.service.create_provider", return_value=Provider()
        ):
            job = self.client.post(f"/api/v1/audits/{audit_id}/figma", json={
                "fileUrl": "https://figma.com/design/abc/Example", "selectionMode": "all-frames", "target": "app",
            })
        self.result(job)
        self.assertTrue(states)
        self.assertEqual(set(states), {"unordered-canvas"})

    def test_android_capture_evidence_reaches_image_analyzer(self):
        audit_id = self.create_audit()

        class Runner:
            last_warnings = ["android_screen_limit"]

            def __init__(self, *args):
                pass

            def capture(self, apk_path, target_dir, **kwargs):
                target_dir.mkdir(parents=True, exist_ok=True)
                captures = []
                for i in range(3):
                    path = target_dir / f"{i}.png"
                    Image.new("RGB", (390, 844), "white").save(path)
                    captures.append(
                        AndroidCapture(
                            path,
                            str(i),
                            390,
                            844,
                            ({"text": "혜택 포기", "bbox": [0.1, 0.2, 0.4, 0.1]},),
                            str(i),
                        )
                    )
                return captures

        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as apk:
            apk.writestr("AndroidManifest.xml", "fixture")
        with (
            patch.dict(
                "os.environ",
                {"BROWSERSTACK_USERNAME": "test", "BROWSERSTACK_ACCESS_KEY": "test"},
            ),
            patch("backend.api.android_import.BrowserStackAndroidRunner", Runner),
            patch(
                "backend.api.service.create_provider", return_value=DetectingProvider()
            ),
        ):
            job = self.client.post(
                f"/api/v1/audits/{audit_id}/mobile-app",
                files={
                    "app": (
                        "fixture.apk",
                        archive.getvalue(),
                        "application/vnd.android.package-archive",
                    )
                },
            )
        result = self.result(job)
        self.assertEqual(len(result["screens"]), 3)
        self.assertEqual(len(result["findings"]), 1)
        self.assertIn("android_screen_limit", result["analysisSummary"]["warnings"])

    def test_url_checks_every_captured_state_with_screen_scoped_dom_ids(self):
        audit_id = self.create_audit()
        artifacts = []
        service.CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        for i in range(7):
            path = service.CAPTURE_DIR / f"{i}.png"
            Image.new("RGB", (400, 800), "white").save(path)
            artifacts.append(
                CaptureArtifact(
                    str(i),
                    f"mobile: {i}",
                    "mobile",
                    "https://example.com",
                    "fixture",
                    path,
                    400,
                    800,
                    state_id=str(i),
                    dom_elements=(
                        {
                            "element_id": "same-option",
                            "element_type": "checkbox",
                            "text": f"option {i}",
                            "bbox": [0.1, 0.2, 0.1, 0.1],
                            "state": {"checked": True},
                            "computed_style": {},
                        },
                    ),
                )
            )
        capture = URLCaptureResult(
            audit_id,
            "https://example.com",
            ScanMode.QUICK,
            (
                CaptureResult(
                    audit_id,
                    "mobile",
                    ScanMode.QUICK,
                    tuple(artifacts),
                    "quick capture completed",
                ),
            ),
        )
        with (
            patch(
                "backend.api.main.UrlSafetyPolicy.validate",
                return_value="https://example.com",
            ),
            patch("backend.api.service.URLCapturePipeline.run", return_value=capture),
        ):
            job = self.client.post(
                f"/api/v1/audits/{audit_id}/capture",
                json={"url": "https://example.com", "profiles": ["mobile"]},
            )
        result = self.result(job)
        self.assertEqual(result["analysisSummary"]["analyzedScreenCount"], 7)
        self.assertEqual(len(result["findings"]), 7)
        self.assertEqual(len({f["bbox"]["screenId"] for f in result["findings"]}), 7)
        self.assertIn("mock_analysis", result["analysisSummary"]["warnings"])

    def test_invalid_upload_is_rejected_before_analysis(self):
        audit_id = self.create_audit()
        response = self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("bad.png", b"not image", "image/png")},
        )
        self.assertEqual(response.status_code, 422)

    def test_upload_normalizes_exif_rotation_before_recording_dimensions(self):
        audit_id = self.create_audit()
        image = Image.new("RGB", (100, 200), "white")
        exif = image.getexif()
        exif[274] = 6
        content = io.BytesIO()
        image.save(content, format="JPEG", exif=exif)
        response = self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("rotated.jpg", content.getvalue(), "image/jpeg")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        screen = response.json()["screens"][0]
        self.assertEqual((screen["width"], screen["height"]), (200, 100))

    def test_old_database_gains_analysis_columns_without_losing_rows(self):
        from sqlalchemy import inspect, text
        from backend.api import store

        audit_id = self.create_audit()
        with store._engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE audit_run DROP COLUMN analysis_summary")
            )
            connection.execute(text("ALTER TABLE screen DROP COLUMN analysis_context"))
        store.init_db()
        store.init_db()
        for table, column in [
            ("audit_run", "analysis_summary"),
            ("screen", "analysis_context"),
        ]:
            self.assertIn(
                column, {c["name"] for c in inspect(store._engine).get_columns(table)}
            )
        summary = self.client.get("/api/v1/dashboard/summary").json()
        self.assertIn(audit_id, [a["id"] for a in summary["audits"]])
