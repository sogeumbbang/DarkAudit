"""Comparison defaults to the original run, and any completed run can be reopened."""
from backend.api import service
from backend.app.models import Audit, AuditRun, Finding, RunStatus, Screen, Severity
from backend.tests.support import IsolatedApiTestCase

# v1 원본 7건(화면 2에 DA-04 3건), v2 수정본 1건(화면 3 신규), v3 수정본 0건.
ORIGINAL = [("DA-04", 2), ("DA-04", 2), ("DA-04", 2), ("DA-07", 1), ("DA-07", 5),
            ("DA-12", 4), ("DA-15", 6)]


class RegressionVersionTest(IsolatedApiTestCase):
    def setUp(self):
        super().setUp()
        with service.SessionLocal() as session:
            audit = Audit(name="재검증 데모", product_name="mobile-web")
            for version, findings, variant in ((1, ORIGINAL, "risky"), (2, [("DA-03", 3)], "revised"),
                                               (3, [], "revised")):
                run = AuditRun(audit=audit, version=version, status=RunStatus.DONE,
                               analysis_summary={"demoVariant": variant})
                run.screens = [Screen(screen_index=i, flow_step=f"단계 {i}") for i in range(1, 7)]
                run.findings = [Finding(
                    rule_id=rule, label_unit="screen", fingerprint=f"{rule}-{screen}-{n}",
                    base_severity=Severity.HIGH, severity=Severity.HIGH, screen_indices=[screen],
                ) for n, (rule, screen) in enumerate(findings)]
            session.add(audit)
            session.commit()
            self.audit_id = f"audit-{audit.id}"

    def regression(self, query=""):
        response = self.client.get(f"/api/v1/audits/{self.audit_id}/regression{query}")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_default_compares_the_original_with_the_latest_run(self):
        body = self.regression()
        self.assertEqual((body["fromVersion"], body["toVersion"]), (1, 3))
        self.assertEqual(len(body["resolved"]) + len(body["pending"]), 7)
        self.assertFalse(body["new"])
        changes = {c["screenId"]: c for c in body["screenChanges"]}
        self.assertEqual(len(changes), 6)
        self.assertEqual((changes["screen-02"]["beforeCount"], changes["screen-02"]["afterCount"],
                          changes["screen-02"]["status"]), (3, 0, "resolved"))
        self.assertEqual(changes["screen-03"]["status"], "clear")

    def test_version_query_selects_both_ends(self):
        body = self.regression("?from_version=1&to_version=2")
        self.assertEqual((body["fromVersion"], body["toVersion"]), (1, 2))
        self.assertEqual([c["ruleId"] for c in body["new"]], ["DA-03"])
        changes = {c["screenId"]: c for c in body["screenChanges"]}
        self.assertEqual((changes["screen-03"]["beforeCount"], changes["screen-03"]["afterCount"],
                          changes["screen-03"]["status"]), (0, 1, "new"))
        # The original short aliases keep working.
        self.assertEqual(self.regression("?from=2&to=3")["fromVersion"], 2)
        # Without from_version, an explicit target still compares against v1.
        self.assertEqual(self.regression("?to_version=2")["fromVersion"], 1)

    def test_two_runs_without_findings_are_reported_as_empty(self):
        with service.SessionLocal() as session:
            run = AuditRun(audit_id=int(self.audit_id.split("-")[1]), version=4, status=RunStatus.DONE)
            run.screens = [Screen(screen_index=i, flow_step=f"단계 {i}") for i in range(1, 7)]
            session.add(run)
            session.commit()
        self.assertEqual(self.regression("?from_version=3&to_version=4")["comparisonStatus"], "empty")
        self.assertNotEqual(self.regression("?to_version=4")["comparisonStatus"], "empty")

    def test_any_completed_run_can_be_reopened_with_its_variant(self):
        original = self.client.get(f"/api/v1/audits/{self.audit_id}/runs/1").json()
        self.assertEqual(len(original["findings"]), 7)
        self.assertEqual(original["demoVariant"], "revised")  # audit-level: latest run
        self.assertEqual([(r["version"], r["findingCount"], r["variant"]) for r in original["runs"]],
                         [(1, 7, "risky"), (2, 1, "revised"), (3, 0, "revised")])
        self.assertEqual(self.client.get(f"/api/v1/audits/{self.audit_id}/runs/9").status_code, 404)
