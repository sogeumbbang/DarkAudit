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
