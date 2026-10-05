import io
import shutil
from urllib.parse import parse_qs, urlencode, urlsplit
from unittest.mock import patch

from PIL import Image

from backend.api import access, service, store
from backend.app.models import Audit, AuditRun, Finding, RunStatus, Severity
from backend.tests.support import IsolatedApiTestCase


class WorkspaceAccessTest(IsolatedApiTestCase):
    def setUp(self):
        super().setUp()
        self.other_token = self.client.post("/api/v1/sessions").json()["token"]
        self.other_headers = {"Authorization": f"Bearer {self.other_token}"}
        self.audit_id = self.client.post("/api/v1/audits", json={
            "name": "Private audit", "platform": "mobile-web",
        }).json()["id"]

    def upload(self):
        content = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(content, format="PNG")
        response = self.client.post(f"/api/v1/audits/{self.audit_id}/screens",
                                    files={"files": ("screen.png", content.getvalue(), "image/png")})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["screens"][0]["imageUrl"]

    def test_anonymous_and_forged_credentials_cannot_read_or_mutate(self):
        for authorization in ("", "Bearer " + "x" * 43):
            for method, path, body in (
                ("GET", "/api/v1/dashboard/summary", None),
                ("POST", "/api/v1/audits", {"name": "Forbidden", "platform": "app"}),
                ("DELETE", f"/api/v1/audits/{self.audit_id}", None),
            ):
                response = self.client.request(method, path, json=body, headers={"Authorization": authorization})
                self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.get("/health", headers={"Authorization": ""}).status_code, 200)

    def test_workspace_filters_dashboard_and_every_owned_entrypoint(self):
        self.upload()
        job = self.client.post(f"/api/v1/audits/{self.audit_id}/analyze").json()
        listing = self.client.get("/api/v1/dashboard/summary", headers=self.other_headers)
        self.assertEqual(listing.json()["audits"], [])
        for method, suffix, body in (
            ("DELETE", "", None), ("GET", "/regression", None), ("POST", "/analyze", None),
            ("POST", "/capture", {"url": "https://example.com", "profiles": ["mobile"]}),
            ("POST", "/figma", {"fileUrl": "https://figma.com/design/abc/Example", "selectionMode": "all-frames", "target": "app"}),
        ):
            with patch("backend.api.main.UrlSafetyPolicy.validate"):
                response = self.client.request(method, f"/api/v1/audits/{self.audit_id}{suffix}", json=body, headers=self.other_headers)
            self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.client.get(f"/api/v1/analysis-jobs/{job['jobId']}", headers=self.other_headers).status_code, 404)
        response = self.client.post(f"/api/v1/audits/{self.audit_id}/screens", headers=self.other_headers,
                                    files={"files": ("screen.png", b"not read", "image/png")})
        self.assertEqual(response.status_code, 404)
        with store.SessionLocal() as session:
            audit = store.get_audit(session, self.audit_id)
            finding = Finding(rule_id="DA-04", label_unit="screen", fingerprint="access",
                              severity=Severity.HIGH, base_severity=Severity.HIGH)
            audit.runs[-1].findings.append(finding)
            session.commit()
            fid = finding.id
        for method, suffix, body in (("PATCH", "", {"status": "resolved"}), ("PUT", "/decision", {"decisionNote": "overwrite"})):
            response = self.client.request(method, f"/api/v1/findings/finding-{fid}{suffix}", json=body, headers=self.other_headers)
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/analysis-jobs/{job['jobId']}").status_code, 200)

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

    def test_legacy_unowned_records_and_id_aliases_are_not_claimed(self):
        with store.SessionLocal() as session:
            legacy = Audit(name="Legacy private")
            session.add(legacy)
            session.commit()
            legacy_id = legacy.id
        self.assertEqual(self.client.delete(f"/api/v1/audits/audit-{legacy_id}").status_code, 404)
        self.assertEqual(len(self.client.get("/api/v1/dashboard/summary").json()["audits"]), 1)
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
        with patch("backend.api.main.shutil.rmtree", side_effect=interleave):
            self.assertEqual(self.client.delete(f"/api/v1/audits/{self.audit_id}").status_code, 204)
        store.init_db()
        newest = self.client.post("/api/v1/audits", json={"name": "After restart", "platform": "app"}).json()
        self.assertNotIn(newest["id"], [self.audit_id, replacements[0]["id"]])
