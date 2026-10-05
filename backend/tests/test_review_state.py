from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy import text

from backend.api import service, store
from backend.app.models import Audit, AuditRun, Finding, FindingStatus, RunStatus, Severity
from backend.tests.support import IsolatedApiTestCase


class ReviewStateTest(IsolatedApiTestCase):
    def setUp(self):
        super().setUp()
        with store.SessionLocal() as session:
            audit = Audit(name="Review state", product_name="mobile-web", owner_id=self.owner_id)
            run = AuditRun(version=1, status=RunStatus.DONE)
            finding = Finding(rule_id="DA-04", label_unit="screen", fingerprint="review",
                              severity=Severity.HIGH, base_severity=Severity.HIGH)
            run.findings.append(finding)
            audit.runs.append(run)
            session.add(audit)
            session.commit()
            self.audit_id = audit.id
            self.finding_id = finding.id

    def _audit(self):
        return next(item for item in self.client.get("/api/v1/dashboard/summary").json()["audits"]
                    if item["id"] == f"audit-{self.audit_id}")

    def test_status_survives_reload_and_updates_activity_order(self):
        self.client.post("/api/v1/audits", json={"name": "Newer audit", "platform": "mobile-web"})
        for index, status in enumerate(("reviewing", "resolved", "reviewing", "open"), 1):
            now = datetime(2030, 1, index, tzinfo=timezone.utc)
            with patch.object(store, "utcnow", return_value=now):
                response = self.client.patch(f"/api/v1/findings/finding-{self.finding_id}",
                                             json={"status": status})
            self.assertEqual(response.status_code, 200, response.text)
            with store.SessionLocal() as session:
                self.assertEqual(session.get(Finding, self.finding_id).status, FindingStatus(status.upper()))
            loaded = self._audit()
            self.assertEqual(loaded["findings"][0]["status"], status)
            self.assertEqual(datetime.fromisoformat(loaded["updatedAt"].replace("Z", "+00:00")), now)
            self.assertEqual(self.client.get("/api/v1/dashboard/summary").json()["audits"][0]["id"], loaded["id"])
            self.assertEqual(self._audit()["updatedAt"], loaded["updatedAt"])

    def test_note_edit_and_clear_touch_audit_but_preserve_creation(self):
        created = self._audit()["createdAt"]
        for day, note in enumerate(("Fix this", ""), 1):
            now = datetime(2031, 1, day, tzinfo=timezone.utc)
            with patch.object(store, "utcnow", return_value=now):
                response = self.client.put(f"/api/v1/findings/finding-{self.finding_id}/decision",
                                           json={"decisionNote": note})
            self.assertEqual(response.status_code, 200)
            loaded = self._audit()
            self.assertEqual(loaded["createdAt"], created)
            self.assertEqual(datetime.fromisoformat(loaded["updatedAt"].replace("Z", "+00:00")), now)

    def test_run_creation_running_failure_and_recovery_touch_audit(self):
        with patch.object(store, "utcnow", return_value=datetime(2032, 1, 1, tzinfo=timezone.utc)):
            with store.SessionLocal() as session:
                run = service.next_run(session, self.audit_id)
                run_id = run.id
                session.commit()
        self.assertTrue(self._audit()["updatedAt"].startswith("2032-01-01"))
        job = service.create_job(f"audit-{self.audit_id}", run_id)
        with patch.object(store, "utcnow", return_value=datetime(2032, 1, 2, tzinfo=timezone.utc)):
            service._mark_running(job.jobId, run_id, 20)
        self.assertTrue(self._audit()["updatedAt"].startswith("2032-01-02"))
        with patch.object(store, "utcnow", return_value=datetime(2032, 1, 3, tzinfo=timezone.utc)):
            service._fail_job(job.jobId, run_id, RuntimeError("test failure"))
        self.assertTrue(self._audit()["updatedAt"].startswith("2032-01-03"))
        with store.SessionLocal() as session:
            session.get(AuditRun, run_id).status = RunStatus.RUNNING
            session.commit()
        with patch.object(store, "utcnow", return_value=datetime(2032, 1, 4, tzinfo=timezone.utc)):
            service.recover_interrupted_runs()
        self.assertTrue(self._audit()["updatedAt"].startswith("2032-01-04"))

    def test_existing_database_migration_preserves_audits(self):
        created = self._audit()["createdAt"]
        with store._engine.begin() as connection:
            connection.execute(text("ALTER TABLE audit DROP COLUMN updated_at"))
        store.init_db()
        store.init_db()
        self.assertEqual(self._audit()["updatedAt"], created)
        response = self.client.patch(f"/api/v1/findings/finding-{self.finding_id}", json={"status": "reviewing"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._audit()["findings"][0]["status"], "reviewing")
