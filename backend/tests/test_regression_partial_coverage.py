"""Long-flow price limitations must not discard verified screen-local rechecks."""
from copy import deepcopy

from ai.pipeline.quality import summarize
from backend.api import service
from backend.app.models import Audit, AuditRun, Finding, FindingStatus, RunStatus, Screen, Severity
from backend.app.regression import compare
from backend.tests.support import IsolatedApiTestCase

RULES = ["DA-03", "DA-04", "DA-07", "DA-12", "DA-15"]


class PartialCoverageRegressionTest(IsolatedApiTestCase):
    def make_run(self, audit, version, detected):
        run = AuditRun(audit=audit, version=version, status=RunStatus.DONE)
        run.screens = [Screen(screen_index=i, flow_step=f"Step {i}") for i in range(1, 7)]
        batches = []
        for indices in ([1, 2, 3, 4, 5], [1, 5, 6]):
            ids = [f"screen-{i:02d}" for i in indices]
            rows = [{
                "rule_id": rule,
                "status": ("insufficient_evidence" if rule == "DA-15" and 6 not in indices
                           else "detected" if rule in detected else "not_detected"),
                "reason": "Recorded assessment fixture", "screen_ids": ids,
            } for rule in RULES]
            batches.append({"screens": ids, "telemetry": {
                "provider": "RecordedTestProvider", "warnings": [], "rule_assessments": rows,
            }})
        run.analysis_summary = summarize({
            "source": "upload", "supportedRules": RULES,
            "warnings": ["long_flow_comparison_limited"], "batches": batches,
        })
        run.findings = [Finding(
            rule_id=rule, label_unit="screen", fingerprint=f"recorded-{rule}",
            base_severity=Severity.HIGH, severity=Severity.HIGH, screen_indices=[2],
        ) for rule in detected]
        return run

    def make_audit(self, session):
        audit = Audit(name="Six-screen recheck", product_name="mobile-web")
        self.make_run(audit, 1, RULES)
        self.make_run(audit, 2, [])
        session.add(audit)
        session.flush()
        return audit

    def test_local_rules_resolve_but_price_and_overall_ratio_stay_pending(self):
        with service.SessionLocal() as session:
            audit = self.make_audit(session)
            result = compare(session, audit.id, 1, 2)
            self.assertEqual({r.rule_id for r in result.resolved}, set(RULES) - {"DA-15"})
            self.assertEqual([r.rule_id for r in result.pending], ["DA-15"])
            self.assertIsNone(result.resolved_ratio)
            self.assertTrue(all(f.status == FindingStatus.OPEN for f in audit.runs[0].findings))
            service._apply_regression(session, audit.runs[-1])
            self.assertEqual(audit.runs[-1].analysis_summary["regression"]["pendingCount"], 1)
            self.assertFalse(audit.runs[-1].analysis_summary["complete"])
            self.assertEqual(
                {f.rule_id for f in audit.runs[0].findings if f.status == FindingStatus.RESOLVED},
                set(RULES) - {"DA-15"},
            )
            session.commit()
            audit_id = audit.id
        body = self.client.get(f"/api/v1/audits/audit-{audit_id}/regression").json()
        self.assertEqual(len(body["resolved"]), 4)
        self.assertEqual(len(body["pending"]), 1)
        self.assertEqual(body["comparisonStatus"], "incomplete")
        self.assertIsNone(body["resolvedRatio"])

    def test_missing_rule_evidence_in_either_run_is_not_overridden_by_clean_batch(self):
        for version in (1, 2):
            for defect in ("insufficient", "missing", "duplicate", "screen_scope"):
                with self.subTest(version=version, defect=defect), service.SessionLocal() as session:
                    audit = self.make_audit(session)
                    run = audit.runs[version - 1]
                    summary = deepcopy(run.analysis_summary)
                    rows = summary["batches"][0]["telemetry"]["rule_assessments"]
                    row = next(r for r in rows if r["rule_id"] == "DA-04")
                    if defect == "insufficient":
                        row["status"] = "insufficient_evidence"
                    elif defect == "missing":
                        rows.remove(row)
                    elif defect == "duplicate":
                        rows.append(deepcopy(row))
                    else:
                        row["screen_ids"] = ["screen-02"]
                    run.analysis_summary = summary
                    report = compare(session, audit.id, 1, 2, update_statuses=True)
                    self.assertEqual({r.rule_id for r in report.pending}, {"DA-04", "DA-15"})
                    self.assertEqual(len(report.resolved), 3)
                    self.assertEqual(next(f for f in audit.runs[0].findings if f.rule_id == "DA-04").status, FindingStatus.OPEN)

    def test_other_warnings_collection_gaps_fake_and_scope_changes_block_all(self):
        for defect in ("mock", "warning", "batch_warning", "fake_provider", "missing_provider", "missing_batch", "extra_screen",
                       "different_step", "different_rules", "failed", "missing_reason"):
            with self.subTest(defect=defect), service.SessionLocal() as session:
                audit = self.make_audit(session)
                run = audit.runs[-1]
                summary = deepcopy(run.analysis_summary)
                if defect == "mock":
                    summary["warnings"].append("mock_analysis")
                elif defect == "warning":
                    summary["warnings"].append("semantic_findings_dropped")
                elif defect == "batch_warning":
                    summary["batches"][0]["telemetry"]["warnings"] = ["analysis_failed"]
                elif defect == "fake_provider":
                    summary["batches"][0]["telemetry"]["provider"] = "FakeAuditProvider"
                elif defect == "missing_provider":
                    summary["batches"][0]["telemetry"].pop("provider")
                elif defect == "missing_batch":
                    summary["batches"].pop()
                elif defect == "extra_screen":
                    summary["batches"][0]["screens"].append("screen-99")
                elif defect == "different_step":
                    run.screens[0].flow_step = "Different path"
                elif defect == "different_rules":
                    summary["supportedRules"] = ["DA-04"]
                elif defect == "failed":
                    run.status = RunStatus.FAILED
                else:
                    summary["warnings"] = []
                run.analysis_summary = summary
                report = compare(session, audit.id, 1, 2, update_statuses=True)
                self.assertFalse(report.resolved)
                self.assertEqual(len(report.pending), 5)
                self.assertTrue(all(f.status == FindingStatus.OPEN for f in audit.runs[0].findings))

    def test_verified_local_resolution_is_remembered_for_recurrence(self):
        with service.SessionLocal() as session:
            audit = self.make_audit(session)
            service._apply_regression(session, audit.runs[-1])
            run = self.make_run(audit, 3, ["DA-04"])
            session.add(run)
            session.flush()
            report = compare(session, audit.id, 2, 3, update_statuses=True)
            self.assertEqual([r.rule_id for r in report.regressed], ["DA-04"])
            self.assertFalse(report.new)
            self.assertEqual(run.findings[0].status, FindingStatus.REGRESSED)
