"""관리용 진단 삭제 스크립트: 화면·API 에서 막힌 보호 진단도 서버 셸에서 --force 로 지울 수 있다."""

import base64
import os
from unittest.mock import patch

from backend.admin_delete_audit import admin_delete_audits
from backend.api import service
from backend.tests.support import IsolatedApiTestCase

PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class AdminDeleteAuditTest(IsolatedApiTestCase):
    def _demo_audit(self, name: str) -> str:
        audit_id = self.client.post("/api/v1/audits", json={
            "name": name, "platform": "mobile-web",
            "demoPreset": {"scenario": "pet", "source": "screenshots"},
        }).json()["id"]
        self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("option.png", PIXEL, "image/png")},
            data={"screen_ids": "option", "flow_steps": "추가 보장 선택"},
        )
        return audit_id

    def _listed(self) -> list[str]:
        return [a["id"] for a in self.client.get("/api/v1/dashboard/summary").json()["audits"]]

    def test_dry_run_reports_without_deleting(self) -> None:
        audit_id = self._demo_audit("실패한 데모")

        with service.SessionLocal() as session:
            plans = admin_delete_audits(session, [audit_id, "audit-999"])

        plan, missing = plans
        self.assertEqual(
            (plan.audit_id, plan.name, plan.demo, plan.protected, plan.deleted),
            (audit_id, "실패한 데모", True, False, False),
        )
        self.assertEqual(plan.runs, ["v1 PENDING · 탐지 0건"])
        self.assertEqual(missing.error, "진단을 찾을 수 없습니다")
        self.assertIn(audit_id, self._listed())
        self.assertTrue((service.UPLOAD_DIR / audit_id).exists())

    def test_apply_deletes_demo_audit_and_its_files(self) -> None:
        target = self._demo_audit("실패한 데모")
        kept = self._demo_audit("심사용 데모")

        with service.SessionLocal() as session:
            [plan] = admin_delete_audits(session, [target], apply=True)

        self.assertTrue(plan.deleted)
        self.assertEqual(self._listed(), [kept])
        self.assertFalse((service.UPLOAD_DIR / target).exists())
        self.assertTrue((service.UPLOAD_DIR / kept).exists())

    def test_protected_audit_needs_force(self) -> None:
        target = self._demo_audit("펫케어 대표 데모")

        with patch.dict(os.environ, {"PROTECTED_AUDIT_IDS": target}):
            self.assertEqual(self.client.delete(f"/api/v1/audits/{target}").status_code, 403)
            with service.SessionLocal() as session:
                [refused] = admin_delete_audits(session, [target], apply=True)
            self.assertTrue(refused.protected)
            self.assertFalse(refused.deleted)
            self.assertEqual(refused.error, "보호된 진단이라 --force 없이는 지우지 않습니다")
            self.assertEqual(self._listed(), [target])

            with service.SessionLocal() as session:
                [plan] = admin_delete_audits(session, [target], apply=True, force=True)

        self.assertTrue(plan.deleted)
        self.assertEqual(self._listed(), [])
        self.assertFalse((service.UPLOAD_DIR / target).exists())
