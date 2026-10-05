from sqlalchemy import inspect, text

from backend.api import store
from backend.app.models import Audit, AuditRun, Finding, RunStatus, Severity
from backend.tests.support import IsolatedApiTestCase


class FindingDecisionTest(IsolatedApiTestCase):
    def setUp(self):
        super().setUp()
        with store.SessionLocal() as session:
            audit = Audit(name="Decision test", owner_id=self.owner_id)
            run = AuditRun(version=1, status=RunStatus.DONE)
            audit.runs.append(run)
            finding = Finding(rule_id="DA-04", label_unit="screen", fingerprint="test",
                              severity=Severity.HIGH, base_severity=Severity.HIGH)
            run.findings.append(finding)
            session.add(audit)
            session.commit()
            self.finding_id = f"finding-{finding.id}"
            self.pk = finding.id

    def test_save_reload_update_and_clear_without_changing_status(self):
        endpoint = f"/api/v1/findings/{self.finding_id}/decision"
        for note in ("  Remove the default selection.  ", "Keep the option; explain the price.", ""):
            response = self.client.put(endpoint, json={"decisionNote": note})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["decisionNote"], note.strip())
            with store.SessionLocal() as session:
                finding = session.get(Finding, self.pk)
                self.assertEqual(finding.decision_note, note.strip())
                self.assertEqual(finding.status.value, "OPEN")
            saved = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]["findings"][0]
            self.assertEqual(saved["decisionNote"], note.strip())
            self.assertEqual(saved["decisionUpdatedAt"], response.json()["decisionUpdatedAt"])

    def test_invalid_and_missing_decisions(self):
        endpoint = f"/api/v1/findings/{self.finding_id}/decision"
        for payload in ({}, {"decisionNote": None}, {"decisionNote": "a" * 4001}):
            self.assertEqual(self.client.put(endpoint, json=payload).status_code, 422)
        for missing in ("bad-id", "finding-999999"):
            self.assertEqual(self.client.put(f"/api/v1/findings/{missing}/decision",
                                            json={"decisionNote": "note"}).status_code, 404)

    def test_existing_database_gets_nullable_columns_idempotently(self):
        with store._engine.begin() as connection:
            connection.execute(text("ALTER TABLE finding DROP COLUMN decision_note"))
            connection.execute(text("ALTER TABLE finding DROP COLUMN decision_updated_at"))
        store.init_db()
        store.init_db()
        columns = {item["name"] for item in inspect(store._engine).get_columns("finding")}
        self.assertTrue({"decision_note", "decision_updated_at"} <= columns)
        response = self.client.put(f"/api/v1/findings/{self.finding_id}/decision",
                                   json={"decisionNote": "Preserve existing data"})
        self.assertEqual(response.status_code, 200)
