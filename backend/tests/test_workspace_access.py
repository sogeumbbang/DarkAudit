import io
import shutil
from urllib.parse import parse_qs, urlencode, urlsplit
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from backend.api import access, main, service, store
from backend.app.models import Audit, Finding, Severity, Workspace
from backend.tests.support import IsolatedApiTestCase


class WorkspaceAccessTest(IsolatedApiTestCase):
    def setUp(self):
        super().setUp()
        self.other_token = self.client.post("/api/v1/sessions").json()["token"]
        self.other_headers = {"Authorization": f"Bearer {self.other_token}"}
        self.audit_id = self.client.post("/api/v1/audits", json={
            "name": "Shared audit", "platform": "mobile-web",
        }).json()["id"]

    def upload(self):
        content = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(content, format="PNG")
        response = self.client.post(f"/api/v1/audits/{self.audit_id}/screens",
                                    files={"files": ("screen.png", content.getvalue(), "image/png")})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["screens"][0]["imageUrl"]

    def test_independent_browsers_share_records_and_mutations(self):
        self.upload()
        job = self.client.post(f"/api/v1/audits/{self.audit_id}/analyze").json()
        with TestClient(main.app) as other_browser:
            listing = other_browser.get("/api/v1/dashboard/summary")
            self.assertEqual(listing.status_code, 200)
            self.assertEqual([audit["id"] for audit in listing.json()["audits"]], [self.audit_id])
            image_url = listing.json()["audits"][0]["screens"][0]["imageUrl"]
            self.assertEqual(other_browser.get(image_url).status_code, 200)
            self.assertEqual(other_browser.get(f"/api/v1/analysis-jobs/{job['jobId']}").status_code, 200)
            with store.SessionLocal() as session:
                audit = store.get_audit(session, self.audit_id)
                finding = Finding(rule_id="DA-04", label_unit="screen", fingerprint="access",
                                  severity=Severity.HIGH, base_severity=Severity.HIGH)
                audit.runs[-1].findings.append(finding)
                session.commit()
                fid = finding.id
            for method, suffix, body in (
                ("PATCH", "", {"status": "resolved"}),
                ("PUT", "/decision", {"decisionNote": "Shared review"}),
            ):
                response = other_browser.request(method, f"/api/v1/findings/finding-{fid}{suffix}", json=body)
                self.assertEqual(response.status_code, 200, response.text)
            reviewed = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
            result = next(item for item in reviewed["findings"] if item["id"] == f"finding-{fid}")
            self.assertEqual(result["status"], "resolved")
            self.assertEqual(result["decisionNote"], "Shared review")
            self.assertEqual(other_browser.delete(f"/api/v1/audits/{self.audit_id}").status_code, 204)
        self.assertEqual(self.client.get("/api/v1/dashboard/summary").json()["audits"], [])

    def test_obsolete_browser_tokens_do_not_partition_records(self):
        for authorization in ("", self.other_headers["Authorization"], "Bearer " + "x" * 43):
            headers = {"Authorization": authorization}
            listing = self.client.get("/api/v1/dashboard/summary", headers=headers)
            self.assertEqual(listing.status_code, 200)
            self.assertIn(self.audit_id, [audit["id"] for audit in listing.json()["audits"]])
            created = self.client.post("/api/v1/audits", headers=headers,
                                       json={"name": "Shared from old browser", "platform": "app"})
            self.assertEqual(created.status_code, 201, created.text)
            self.assertEqual(self.client.delete(f"/api/v1/audits/{created.json()['id']}").status_code, 204)

    def test_only_signed_exact_images_are_publicly_retrievable(self):
        url = self.upload()
        raw = urlsplit(url).path
        self.assertEqual(self.client.get(url, headers={"Authorization": ""}).status_code, 200)
        for path in (raw, "/artifacts/test.db", "/artifacts/jobs.sqlite3", "/artifacts/android/app.apk", "/artifacts/figma/manifest.json"):
            self.assertEqual(self.client.get(path).status_code, 404, path)
        query = parse_qs(urlsplit(url).query)
        for changes in ({"audit": "audit-9999"}, {"expires": "1"}, {"signature": "0" * 64}):
            altered = {key: value[0] for key, value in query.items()} | changes
            self.assertEqual(self.client.get(raw + "?" + urlencode(altered)).status_code, 404)
        # One image's capability cannot authorize its sibling or a traversal.
        self.assertEqual(self.client.get(url.replace("01.png", "02.png")).status_code, 404)
        for relative in ("uploads/../test.db", "uploads//01.png", "uploads/..%2Ftest.db", "uploads\\test.png"):
            with self.assertRaises(ValueError):
                access.image_relative_path("/artifacts/" + relative)
        with store.SessionLocal() as session:
            image_path = service.DATA_DIR / raw.removeprefix("/artifacts/")
            image_path.unlink()
            image_path.symlink_to(service.DATA_DIR / "test.db")
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/v1/audits/{self.audit_id}").status_code, 204)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_existing_owned_and_unowned_records_are_shared_after_restart(self):
        image_url = self.upload()
        with store.SessionLocal() as session:
            session.add(Workspace(id="old-browser", token_hash="a" * 64))
            owned = Audit(name="Old browser audit", owner_id="old-browser")
            unowned = Audit(name="Legacy unowned")
            session.add_all([owned, unowned])
            session.flush()
            # Simulate a database from before the image-signing migration.
            unowned.artifact_secret = None
            original = store.get_audit(session, self.audit_id)
            original.artifact_secret = None
            original.owner_id = "old-browser"
            session.commit()
            expected_ids = {self.audit_id, f"audit-{owned.id}", f"audit-{unowned.id}"}
        store.init_db()
        listing = self.client.get("/api/v1/dashboard/summary").json()["audits"]
        self.assertEqual({audit["id"] for audit in listing}, expected_ids)
        restored = next(audit for audit in listing if audit["id"] == self.audit_id)
        restored_url = restored["screens"][0]["imageUrl"]
        self.assertEqual(self.client.get(restored_url).status_code, 200)
        self.assertEqual(self.client.get(image_url).status_code, 404)
        store.init_db()
        self.assertEqual(self.client.get(restored_url).status_code, 200)
        for alias in (self.audit_id.replace("audit-", "other-"), self.audit_id.replace("audit-", "audit-0")):
            self.assertEqual(self.client.delete(f"/api/v1/audits/{alias}").status_code, 404)

    def test_workspace_survives_database_reinitialization(self):
        store.init_db()
        self.assertEqual(self.client.get("/api/v1/dashboard/summary").json()["audits"][0]["id"], self.audit_id)

    def test_deleted_audit_identity_is_not_reused_during_cleanup(self):
        image_url = self.upload()
        job = self.client.post(f"/api/v1/audits/{self.audit_id}/analyze").json()
        original_rmtree = shutil.rmtree
        replacements = []
        def interleave(path, **kwargs):
            if not replacements:
                replacement = self.client.post("/api/v1/audits", headers=self.other_headers,
                    json={"name": "Other workspace", "platform": "app"}).json()
                replacements.append(replacement)
                self.assertNotEqual(replacement["id"], self.audit_id)
                self.assertIsNone(replacement["latestJobId"])
                self.assertEqual(self.client.get(f"/api/v1/analysis-jobs/{job['jobId']}", headers=self.other_headers).status_code, 404)
                self.assertEqual(self.client.get(image_url).status_code, 404)
            original_rmtree(path, **kwargs)
        with patch("backend.api.service.shutil.rmtree", side_effect=interleave):
            self.assertEqual(self.client.delete(f"/api/v1/audits/{self.audit_id}").status_code, 204)
        store.init_db()
        newest = self.client.post("/api/v1/audits", json={"name": "After restart", "platform": "app"}).json()
        self.assertNotIn(newest["id"], [self.audit_id, replacements[0]["id"]])
