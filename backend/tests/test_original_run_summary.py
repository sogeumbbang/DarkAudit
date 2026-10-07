"""원본(v1) 결과는 수정본 검사 뒤에도 그대로 남아야 한다."""

from sqlalchemy import text

from backend.api import service, store
from backend.app.models import Audit, FindingStatus
from backend.reset_demo_review_status import reset_demo_review_status
from backend.tests.support import IsolatedApiTestCase
from backend.tests import test_regression_regressed as regressed


def summary_card(audit: dict) -> dict:
    """원본 검사 탭 상단 카드와 같은 기준으로 센다."""
    statuses = [finding["status"] for finding in audit["findings"]]
    return {
        "total": len(statuses),
        "needsReview": sum(status != "resolved" for status in statuses),
        "resolved": statuses.count("resolved"),
        "screens": len(audit["screens"]),
    }


def regression_counts(body: dict) -> dict:
    keys = ("resolved", "persisted", "improved", "new", "regressed", "pending")
    return {key: [c["ruleId"] for c in body[key]] for key in keys} | {"resolvedRatio": body["resolvedRatio"]}


class OriginalRunSummaryTest(IsolatedApiTestCase):
    _new_audit = regressed.RegressedFindingTest._new_audit
    _run = regressed.RegressedFindingTest._run

    def _original(self, audit_id: str) -> dict:
        response = self.client.get(f"/api/v1/audits/{audit_id}/runs/1")
        self.assertEqual(response.status_code, 200, response.text)
        return summary_card(response.json())

    def _comparisons(self, audit_id: str) -> dict:
        return {
            (a, b): regression_counts(self.client.get(
                f"/api/v1/audits/{audit_id}/regression?from_version={a}&to_version={b}"
            ).json())
            for a, b in ((1, 2), (1, 3), (2, 3))
        }

    def _stored(self, audit_id: str) -> Audit:
        session = service.SessionLocal()
        self.addCleanup(session.close)
        return session.get(Audit, int(audit_id.split("-")[-1]))

    def test_fixed_revision_does_not_mark_original_findings_resolved(self) -> None:
        audit_id = self._new_audit()
        self._run(audit_id, detecting=True)
        before = self._original(audit_id)
        self.assertEqual(before, {"total": 1, "needsReview": 1, "resolved": 0, "screens": 1})

        self._run(audit_id, detecting=False)

        self.assertEqual(self._original(audit_id), before)
        # 비교 판정은 따로 남아 수정본 탭과 전후 비교는 그대로 해결로 본다.
        stored = self._stored(audit_id).runs[0].findings[0]
        self.assertEqual(stored.status, FindingStatus.OPEN)
        self.assertEqual(stored.comparison_status, FindingStatus.RESOLVED)
        comparison = self.client.get(f"/api/v1/audits/{audit_id}/regression").json()
        self.assertEqual([c["ruleId"] for c in comparison["resolved"]], ["DA-12"])
        self.assertEqual(comparison["resolvedRatio"], 1.0)

    def test_persisted_revision_keeps_manual_resolved_mark_on_original(self) -> None:
        audit_id = self._new_audit()
        self._run(audit_id, detecting=True)
        finding_id = self.client.get(f"/api/v1/audits/{audit_id}/runs/1").json()["findings"][0]["id"]
        self.client.patch(f"/api/v1/findings/{finding_id}", json={"status": "resolved"})
        before = self._original(audit_id)
        self.assertEqual(before, {"total": 1, "needsReview": 0, "resolved": 1, "screens": 1})

        self._run(audit_id, detecting=True)

        self.assertEqual(self._original(audit_id), before)
        latest = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(summary_card(latest)["resolved"], 0)
        comparison = self.client.get(f"/api/v1/audits/{audit_id}/regression").json()
        self.assertEqual([c["ruleId"] for c in comparison["persisted"]], ["DA-12"])

    def test_migration_backfills_legacy_comparison_status_without_changing_comparisons(self) -> None:
        audit_id = self._new_audit()
        self._run(audit_id, detecting=True)    # v1 발견
        self._run(audit_id, detecting=False)   # v2 해결
        self._run(audit_id, detecting=True)    # v3 재발
        expected = self._comparisons(audit_id)
        self.assertEqual(expected[(2, 3)]["regressed"], ["DA-12"])

        # 이전 버전 DB: 비교 판정이 status 에 덮어써져 있고 comparison_status 컬럼이 없다.
        with store._engine.begin() as connection:
            connection.execute(text(
                "UPDATE finding SET status = comparison_status WHERE comparison_status IS NOT NULL"
            ))
            connection.execute(text("ALTER TABLE finding DROP COLUMN comparison_status"))
        with store._engine.connect() as connection:
            legacy = connection.execute(text("SELECT status FROM finding ORDER BY id")).scalars().all()
        self.assertEqual(legacy, ["RESOLVED", "REGRESSED"])

        store.init_db()
        store.init_db()

        self.assertEqual(self._comparisons(audit_id), expected)
        runs = sorted(self._stored(audit_id).runs, key=lambda run: run.version)
        self.assertEqual(
            [run.findings[0].comparison_status for run in runs if run.findings],
            [FindingStatus.RESOLVED, None],
        )

    def test_demo_reset_restores_original_status_but_keeps_comparisons(self) -> None:
        demo_id = self.client.post("/api/v1/audits", json={
            "name": "데모", "platform": "mobile-web",
            "demoPreset": {"scenario": "pet", "source": "screenshots"},
        }).json()["id"]
        other_id = self._new_audit()
        for audit_id in (demo_id, other_id):
            self._run(audit_id, detecting=True)
            self._run(audit_id, detecting=False)
            self._run(audit_id, detecting=True)
        expected = self._comparisons(demo_id)
        with store._engine.begin() as connection:
            connection.execute(text(
                "UPDATE finding SET status = comparison_status WHERE comparison_status IS NOT NULL"
            ))
        self.assertEqual(self._original(demo_id)["resolved"], 1)

        with service.SessionLocal() as session:
            plans = reset_demo_review_status(session, [demo_id, other_id, "audit-999"])
        self.assertEqual([(p.audit_id, p.version, p.total, p.changed) for p in plans[:1]], [(demo_id, 1, 1, 1)])
        self.assertEqual([p.error is not None for p in plans], [False, True, True])
        self.assertEqual(self._original(demo_id)["resolved"], 1, "dry-run 은 저장하지 않는다")

        with service.SessionLocal() as session:
            reset_demo_review_status(session, [demo_id, other_id], apply=True)

        self.assertEqual(self._original(demo_id), {"total": 1, "needsReview": 1, "resolved": 0, "screens": 1})
        self.assertEqual(self._original(other_id)["resolved"], 1, "데모가 아닌 진단은 그대로 둔다")
        self.assertEqual(self._comparisons(demo_id), expected)
        self.assertEqual(
            self._stored(demo_id).runs[0].findings[0].comparison_status, FindingStatus.RESOLVED
        )
