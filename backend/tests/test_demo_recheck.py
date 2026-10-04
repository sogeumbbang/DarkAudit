import json

from sqlalchemy import text

from backend.api import store
from backend.api.demo_inputs import CASES_DIR
from backend.tests.support import IsolatedApiTestCase


class DemoRecheckTest(IsolatedApiTestCase):
    def test_original_partial_and_revised_use_one_audit_and_normal_analysis(self):
        preset = {"scenario": "pet", "source": "screenshots"}
        created = self.client.post("/api/v1/audits", json={
            "name": "Three demo versions", "platform": "mobile-web", "demoPreset": preset,
        })
        self.assertEqual(created.status_code, 201, created.text)
        audit_id = created.json()["id"]
        case = json.loads((CASES_DIR / "manifest.json").read_text())["cases"][0]
        for version, variant in enumerate(case["variants"], 1):
            uploaded = self.client.post(f"/api/v1/audits/{audit_id}/screens", files=[
                ("files", (screen["fileName"], (CASES_DIR / "pet" / variant["id"] / screen["fileName"]).read_bytes(), "image/png"))
                for screen in variant["screens"]
            ], data={"flow_steps": [screen["flowStep"] for screen in variant["screens"]], "demo_variant": variant["id"]})
            self.assertEqual(uploaded.status_code, 200, uploaded.text)
            self.assertEqual(uploaded.json()["demoVariant"], variant["id"])
            job = self.client.post(f"/api/v1/audits/{audit_id}/analyze")
            self.assertEqual(job.status_code, 202, job.text)
            result = self.client.get(f"/api/v1/analysis-jobs/{job.json()['jobId']}").json()
            self.assertEqual(result["status"], "completed", result)
            audits = self.client.get("/api/v1/dashboard/summary").json()["audits"]
            self.assertEqual(len(audits), 1)
            audit = audits[0]
            self.assertEqual(audit["demoPreset"], preset)
            self.assertEqual(audit["demoVariant"], variant["id"])
            self.assertEqual(len(audit["runs"]), version)
            self.assertEqual(len(audit["screens"]), 6)
            # Authored expectations never replace the provider's real result.
            self.assertEqual(audit["findings"], [])
            self.assertFalse(audit["analysisSummary"]["complete"])
        comparison = self.client.get(f"/api/v1/audits/{audit_id}/regression").json()
        self.assertEqual((comparison["fromVersion"], comparison["toVersion"]), (2, 3))
        self.assertIsNone(comparison["resolvedRatio"])

    def test_demo_metadata_validation_and_existing_database_migration(self):
        for preset in ({"scenario": "missing", "source": "screenshots"}, {"scenario": "pet", "source": "unknown"}):
            response = self.client.post("/api/v1/audits", json={"name": "demo", "platform": "mobile-web", "demoPreset": preset})
            self.assertEqual(response.status_code, 422)
        audit_id = self.client.post("/api/v1/audits", json={"name": "Existing audit", "platform": "mobile-web"}).json()["id"]
        with store._engine.begin() as connection:
            connection.execute(text("ALTER TABLE audit DROP COLUMN demo_preset"))
        store.init_db()
        store.init_db()
        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(audit["id"], audit_id)
        self.assertIsNone(audit["demoPreset"])

    def test_native_demo_versions_preserve_source_and_history(self):
        import os
        from pathlib import Path
        from unittest.mock import patch
        from backend.api.android_runner import AndroidCapture
        from backend.api.demo_inputs import APK_PATH, DEFAULT_FIGMA_URL
        from backend.tests.test_figma_import import _TINY_PNG, _PROTOTYPE_DOCUMENT

        class Client:
            def __init__(self, *args): pass
            def get_file(self, key): return {"document": _PROTOTYPE_DOCUMENT}
            def render_frames(self, key, ids): return {node: node for node in ids}
            def download_render(self, url, destination, **kwargs):
                destination.write_bytes(_TINY_PNG)
                return len(_TINY_PNG)

        class Runner:
            last_warnings = []
            def __init__(self, *args): pass
            def capture(self, apk, target, **kwargs):
                target.mkdir(parents=True, exist_ok=True)
                path = target / "01.png"
                path.write_bytes(_TINY_PNG)
                return [AndroidCapture(path, "앱 실행", 393, 852)]

        with patch("backend.api.figma_import.FigmaClient", Client), patch(
            "backend.api.android_import.BrowserStackAndroidRunner", Runner
        ), patch.dict(os.environ, {"BROWSERSTACK_USERNAME": "user", "BROWSERSTACK_ACCESS_KEY": "key"}):
            for source, scenario, platform in (("figma", "credit", "mobile-web"), ("android", "moa", "app")):
                preset = {"scenario": scenario, "source": source}
                audit_id = self.client.post("/api/v1/audits", json={
                    "name": source, "platform": platform, "demoPreset": preset,
                }).json()["id"]
                for version, variant in enumerate(("risky", "partial", "revised"), 1):
                    if source == "figma":
                        response = self.client.post(f"/api/v1/audits/{audit_id}/figma", json={
                            "fileUrl": DEFAULT_FIGMA_URL, "target": platform,
                            "selectionMode": "prototype-flow", "flowName": "가입 Flow", "demoVariant": variant,
                        })
                    else:
                        response = self.client.post(f"/api/v1/audits/{audit_id}/mobile-app", data={"demo_variant": variant},
                            files={"app": (f"{variant}.apk", APK_PATH.with_name(f"darkaudit-demo-{variant}.apk").read_bytes(), "application/vnd.android.package-archive")})
                    self.assertEqual(response.status_code, 202, response.text)
                    job = self.client.get(f"/api/v1/analysis-jobs/{response.json()['jobId']}").json()
                    self.assertEqual(job["status"], "completed", job)
                    audit = next(a for a in self.client.get("/api/v1/dashboard/summary").json()["audits"] if a["id"] == audit_id)
                    self.assertEqual(audit["demoPreset"], preset)
                    self.assertEqual(audit["demoVariant"], variant)
                    self.assertEqual(audit["analysisSummary"]["source"], source)
                    self.assertEqual(len(audit["runs"]), version)
                    self.assertEqual(audit["findings"], [])
