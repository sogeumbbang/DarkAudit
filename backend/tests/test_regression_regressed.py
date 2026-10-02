"""재발(REGRESSED) 판정: 한 번 해결된 finding이 이후 회차에 다시 나타나는 경우."""

import base64
from unittest.mock import patch

from backend.tests.support import IsolatedApiTestCase
from backend.tests.test_api import DetectingProvider

PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class RegressedFindingTest(IsolatedApiTestCase):
    def _new_audit(self) -> str:
        return self.client.post(
            "/api/v1/audits", json={"name": "재발 판정 진단", "platform": "mobile-web"}
        ).json()["id"]

    def _run(self, audit_id: str, *, detecting: bool) -> None:
        """화면을 올려 새 회차를 만들고 분석한다. detecting=False 면 아무것도 찾지 못한다."""
        self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("option.png", PIXEL, "image/png")},
            data={"screen_ids": "option", "flow_steps": "추가 보장 선택"},
        )
        if detecting:
            with patch("backend.api.service.create_provider", return_value=DetectingProvider()):
                job = self.client.post(f"/api/v1/audits/{audit_id}/analyze").json()
        else:
            job = self.client.post(f"/api/v1/audits/{audit_id}/analyze").json()
        status = self.client.get(f"/api/v1/analysis-jobs/{job['jobId']}").json()["status"]
        self.assertEqual(status, "completed")

    def test_finding_resolved_in_v2_and_back_in_v3_is_regressed_not_new(self) -> None:
        audit_id = self._new_audit()
        self._run(audit_id, detecting=True)    # v1: DA-12 발견
        self._run(audit_id, detecting=False)   # v2: 해결
        self._run(audit_id, detecting=True)    # v3: 같은 문제가 다시 나타남

        body = self.client.get(f"/api/v1/audits/{audit_id}/regression").json()
        self.assertEqual((body["fromVersion"], body["toVersion"]), (2, 3))
        self.assertEqual([c["ruleId"] for c in body["regressed"]], ["DA-12"])
        self.assertEqual(body["new"], [])
        self.assertEqual(body["resolved"], [])
        self.assertEqual(body["regressed"][0]["after"], "REVIEW")
        # 이전 회차에 없던 문제가 재발한 경우는 분모(이전 회차 문제)에 들어가지 않는다.
        self.assertEqual(body["resolvedRatio"], 0.0)

    def test_latest_run_keeps_regressed_finding_in_dashboard(self) -> None:
        audit_id = self._new_audit()
        self._run(audit_id, detecting=True)
        self._run(audit_id, detecting=False)
        self._run(audit_id, detecting=True)
        self.client.get(f"/api/v1/audits/{audit_id}/regression")

        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual([f["ruleId"] for f in audit["findings"]], ["DA-12"])
        self.assertEqual(audit["runs"][-1]["version"], 3)

    def test_never_resolved_finding_that_appears_later_is_new(self) -> None:
        """한 번도 해결된 적 없는 문제가 v2에 처음 생기면 재발이 아니라 신규다."""
        audit_id = self._new_audit()
        self._run(audit_id, detecting=False)   # v1: 문제 없음
        self._run(audit_id, detecting=True)    # v2: 처음 등장

        body = self.client.get(f"/api/v1/audits/{audit_id}/regression").json()
        self.assertEqual([c["ruleId"] for c in body["new"]], ["DA-12"])
        self.assertEqual(body["regressed"], [])
