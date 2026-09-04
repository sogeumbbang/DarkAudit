from __future__ import annotations

import base64
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_temp_root = Path(tempfile.mkdtemp(prefix="darkaudit-api-test-"))
os.environ["DARKAUDIT_DB_URL"] = f"sqlite:///{(_temp_root / 'test.db').as_posix()}"
os.environ["DARKAUDIT_PROVIDER"] = "fake"

from fastapi.testclient import TestClient

from ai.browser.models import CaptureArtifact, CaptureResult, ScanMode
from ai.pipeline.web_audit import URLAuditResult, URLCaptureResult
from ai.schemas.audit_schema import (
    HybridAuditOutput,
    RISK_NAME_MAP,
    RiskType,
    RuleCandidate,
    ScreenReference,
)
from backend.api import service
from backend.app.models import Audit, AuditRun, Element, FlowType, RunStatus, Screen
from backend.app.rule_engine.severity import ScoredFinding

service.DATA_DIR = _temp_root
service.UPLOAD_DIR = _temp_root / "uploads"
service.CAPTURE_DIR = _temp_root / "captures"

from backend.api.main import app


class DetectingProvider:
    def analyze(self, request, system_prompt, audit_prompt, rules, output_schema, candidates=None):
        screen = request.screens[0]
        return {
            "audit_id": request.audit_id,
            "schema_version": request.schema_version,
            "screens": [
                {"screen_id": item.screen_id, "flow_step": item.flow_step}
                for item in request.screens
            ],
            "candidate_decisions": [],
            "semantic_findings": [
                {
                    "risk_type": RiskType.EMOTIONAL_LANGUAGE.value,
                    "risk_name": RISK_NAME_MAP[RiskType.EMOTIONAL_LANGUAGE],
                    "where": {
                        "screen_ids": [screen.screen_id],
                        "element": "해외 치료비 보장",
                        "location": "추가 보장 선택 영역",
                    },
                    "bbox": [0.1, 0.2, 0.05, 0.05],
                    "related_elements": [],
                    "what": "유료 선택 항목이 미리 선택되어 있습니다.",
                    "observation": "체크박스가 선택 상태로 표시됩니다.",
                    "rule_id": "DA-12",
                    "why": "사용자가 추가 비용을 그대로 수용할 수 있습니다.",
                    "severity": "REVIEW",
                    "confidence": 0.92,
                    "fix": "초기 상태를 미선택으로 변경합니다.",
                }
            ],
        }


class ApiIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_context.__exit__(None, None, None)
        shutil.rmtree(_temp_root, ignore_errors=True)

    def test_uploaded_audit_runs_pipeline_and_persists_finding(self) -> None:
        created = self.client.post(
            "/api/v1/audits",
            json={"name": "보험 가입 진단", "platform": "mobile-web"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        audit_id = created.json()["id"]

        image = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )
        uploaded = self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("option.png", image, "image/png")},
            data={"screen_ids": "option", "flow_steps": "추가 보장 선택"},
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        self.assertEqual(uploaded.json()["screens"][0]["flowStep"], "추가 보장 선택")

        with patch("backend.api.service.create_provider", return_value=DetectingProvider()):
            queued = self.client.post(f"/api/v1/audits/{audit_id}/analyze")
        self.assertEqual(queued.status_code, 202, queued.text)
        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)

        dashboard = self.client.get("/api/v1/dashboard/summary")
        self.assertEqual(dashboard.status_code, 200, dashboard.text)
        audit = dashboard.json()["audits"][0]
        self.assertRegex(audit["updatedAt"], r"(?:Z|\+00:00)$")
        self.assertEqual(audit["status"], "completed")
        self.assertEqual(len(audit["findings"]), 1)
        finding = audit["findings"][0]
        self.assertEqual(finding["ruleId"], "DA-12")
        self.assertEqual(finding["element"], "해외 치료비 보장")

        resolved = self.client.patch(
            f"/api/v1/findings/{finding['id']}", json={"status": "resolved"}
        )
        self.assertEqual(resolved.status_code, 200, resolved.text)

    def test_url_capture_persists_selected_screens(self) -> None:
        audit_id = self.client.post(
            "/api/v1/audits",
            json={"name": "URL 진단", "platform": "mobile-web"},
        ).json()["id"]
        image_path = service.CAPTURE_DIR / "captured.png"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(b"capture")
        artifact = CaptureArtifact(
            screen_id="mobile-initial",
            flow_step="mobile: initial viewport",
            profile="mobile",
            url="https://example.com",
            title="Example",
            image_path=image_path,
            viewport_width=393,
            viewport_height=852,
        )
        result = URLAuditResult(
            URLCaptureResult(
                audit_id=audit_id,
                url="https://example.com",
                mode=ScanMode.QUICK,
                profiles=(
                    CaptureResult(
                        audit_id=audit_id,
                        profile="mobile",
                        mode=ScanMode.QUICK,
                        artifacts=(artifact,),
                        stop_reason="quick capture completed",
                    ),
                ),
            ),
            HybridAuditOutput(
                audit_id=audit_id,
                schema_version="1.1",
                screens=(ScreenReference("mobile-initial", "mobile: initial viewport"),),
                candidate_decisions=(),
                semantic_findings=(),
                candidates=(),
            ),
        )

        with (
            patch("backend.api.main.UrlSafetyPolicy.validate", return_value="https://example.com"),
            patch("backend.api.service.URLCapturePipeline.run", return_value=result.capture),
            patch("backend.api.service.BaselineAuditPipeline.analyze", return_value=result.analysis),
        ):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/capture",
                json={
                    "url": "https://example.com",
                    "mode": "quick",
                    "profiles": ["mobile"],
                },
            )
        self.assertEqual(queued.status_code, 202, queued.text)
        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)
        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(audit["screens"][0]["flowStep"], "mobile: initial viewport")
        self.assertEqual(audit["screens"][0]["width"], 393)

    def test_hybrid_output_merges_by_candidate_id_and_recalculates_severity(self) -> None:
        audit_id = self.client.post(
            "/api/v1/audits",
            json={"name": "Hybrid URL audit", "platform": "mobile-web"},
        ).json()["id"]
        image_path = service.CAPTURE_DIR / "hybrid.png"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(b"capture")
        artifact = CaptureArtifact(
            screen_id="mobile-hybrid",
            flow_step="mobile: offer",
            profile="mobile",
            url="https://example.com",
            title="Example",
            image_path=image_path,
            viewport_width=393,
            viewport_height=852,
            dom_elements=(
                {
                    "element_id": "keep-option", "element_type": "checkbox",
                    "text": "Paid option", "bbox": [0.1, 0.2, 0.2, 0.1],
                    "state": {"checked": True}, "computed_style": {},
                },
                {
                    "element_id": "reject-footer", "element_type": "text",
                    "text": "Copyright footer", "bbox": [0.1, 0.8, 0.6, 0.05],
                    "state": {}, "computed_style": {"font_size": 10},
                },
            ),
        )
        capture = URLCaptureResult(
            audit_id=audit_id,
            url="https://example.com",
            mode=ScanMode.QUICK,
            profiles=(CaptureResult(
                audit_id=audit_id,
                profile="mobile",
                mode=ScanMode.QUICK,
                artifacts=(artifact,),
                stop_reason="quick capture completed",
            ),),
        )
        rule_findings = [
            ScoredFinding(
                rule_id="DA-04", label_unit="element", screen_index=1,
                primary_id="keep-option", triggered_checks=["premium_option_default"],
                measurements={"checked": True},
            ),
            ScoredFinding(
                rule_id="DA-04", label_unit="element", screen_index=1,
                primary_id="reject-footer", triggered_checks=["premium_option_default"],
                measurements={"checked": False},
            ),
        ]
        seen_candidates = []

        def analyze(request, candidates):
            seen_candidates.extend(candidates)
            decisions = [
                {
                    "candidate_id": item["candidate_id"],
                    "decision": "KEEP" if item["primary_element_id"] == "keep-option" else "REJECT",
                    "reason": "Verified against the captured screen",
                    "confidence": 0.91,
                    "base_severity": "HIGH",
                }
                for item in reversed(candidates)
            ]
            semantic = {
                "risk_type": RiskType.EMOTIONAL_LANGUAGE.value,
                "risk_name": RISK_NAME_MAP[RiskType.EMOTIONAL_LANGUAGE],
                "where": {
                    "screen_ids": ["mobile-hybrid"],
                    "element": "Lose your benefits",
                    "location": "offer footer",
                },
                "bbox": [0.1, 0.7, 0.5, 0.08],
                "related_elements": [],
                "what": "Loss-framed decline",
                "observation": "The decline label says benefits will be lost",
                "rule_id": "DA-12",
                "why": "The wording frames decline as a loss",
                "severity": "REVIEW",
                "confidence": 0.9,
                "fix": "Use a neutral decline label",
            }
            raw = {
                "audit_id": audit_id,
                "schema_version": "1.1",
                "screens": [{"screen_id": "mobile-hybrid", "flow_step": "mobile: offer"}],
                "candidate_decisions": decisions,
                "semantic_findings": [semantic],
            }
            return HybridAuditOutput.from_dict(
                raw, [RuleCandidate.from_dict(item) for item in candidates]
            )

        with (
            patch("backend.api.main.UrlSafetyPolicy.validate", return_value="https://example.com"),
            patch("backend.api.service.URLCapturePipeline.run", return_value=capture),
            patch("backend.api.service._run_rule_engine", return_value=rule_findings),
            patch("backend.api.service.BaselineAuditPipeline.analyze", side_effect=analyze),
        ):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/capture",
                json={"url": "https://example.com", "mode": "quick", "profiles": ["mobile"]},
            )

        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(
            {tuple(item) for item in (
                (candidate["candidate_id"], candidate["screen_id"], candidate["screen_index"])
                for candidate in seen_candidates
            )},
            {
                ("DA-04:mobile-hybrid:keep-option", "mobile-hybrid", 1),
                ("DA-04:mobile-hybrid:reject-footer", "mobile-hybrid", 1),
            },
        )
        dashboard = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        findings = {item["ruleId"]: item for item in dashboard["findings"]}
        self.assertEqual(set(findings), {"DA-04", "DA-12"})
        self.assertEqual(findings["DA-04"]["element"], "Paid option")
        self.assertEqual(findings["DA-12"]["severity"], "HIGH")

    def test_regression_endpoint_reports_resolved_finding_across_runs(self) -> None:
        audit_id = self.client.post(
            "/api/v1/audits",
            json={"name": "회귀 비교 진단", "platform": "mobile-web"},
        ).json()["id"]
        image = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )

        # 회차 없음/1개뿐일 때는 아직 비교할 게 없다.
        empty = self.client.get(f"/api/v1/audits/{audit_id}/regression")
        self.assertEqual(empty.status_code, 409, empty.text)

        # v1: DetectingProvider 가 DA-12 하나를 찾는다.
        self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("option.png", image, "image/png")},
            data={"screen_ids": "option", "flow_steps": "추가 보장 선택"},
        )
        with patch("backend.api.service.create_provider", return_value=DetectingProvider()):
            job1 = self.client.post(f"/api/v1/audits/{audit_id}/analyze").json()
        self.assertEqual(
            self.client.get(f"/api/v1/analysis-jobs/{job1['jobId']}").json()["status"], "completed"
        )

        one_run = self.client.get(f"/api/v1/audits/{audit_id}/regression")
        self.assertEqual(one_run.status_code, 409, one_run.text)

        # v2: 문제를 고쳤다고 가정 — 아무것도 안 찾는 provider.
        self.client.post(
            f"/api/v1/audits/{audit_id}/screens",
            files={"files": ("option.png", image, "image/png")},
            data={"screen_ids": "option", "flow_steps": "추가 보장 선택"},
        )
        job2 = self.client.post(f"/api/v1/audits/{audit_id}/analyze").json()
        self.assertEqual(
            self.client.get(f"/api/v1/analysis-jobs/{job2['jobId']}").json()["status"], "completed"
        )

        regression = self.client.get(f"/api/v1/audits/{audit_id}/regression")
        self.assertEqual(regression.status_code, 200, regression.text)
        body = regression.json()
        self.assertEqual(body["auditId"], audit_id)
        self.assertEqual(body["fromVersion"], 1)
        self.assertEqual(body["toVersion"], 2)
        self.assertEqual(len(body["resolved"]), 1)
        self.assertEqual(body["resolved"][0]["ruleId"], "DA-12")
        self.assertEqual(body["resolved"][0]["before"], "REVIEW")
        self.assertIsNone(body["resolved"][0]["after"])
        self.assertEqual(body["new"], [])
        self.assertEqual(body["resolvedRatio"], 1.0)

        # 명시적 from/to 도 동작해야 한다 (v1 vs v1).
        same = self.client.get(f"/api/v1/audits/{audit_id}/regression?from=1&to=1")
        self.assertEqual(same.status_code, 200, same.text)
        self.assertEqual(same.json()["resolved"], [])
        self.assertEqual(same.json()["persisted"][0]["ruleId"], "DA-12")

        missing_version = self.client.get(f"/api/v1/audits/{audit_id}/regression?from=1&to=99")
        self.assertEqual(missing_version.status_code, 404, missing_version.text)

    def test_regression_endpoint_missing_audit_returns_404(self) -> None:
        response = self.client.get("/api/v1/audits/audit-999999/regression")
        self.assertEqual(response.status_code, 404, response.text)

    def test_da15_primary_bbox_is_kept_on_final_evidence_screen(self) -> None:
        with service.SessionLocal() as session:
            audit = Audit(name="Sequential pricing", product_name="mobile-web")
            run = AuditRun(version=1, status=RunStatus.DONE)
            audit.runs.append(run)
            run.screens.extend([
                Screen(
                    flow_type=FlowType.join,
                    screen_index=1,
                    flow_step="mobile: initial price",
                    image_path="/artifacts/initial.png",
                    viewport_w=390,
                    viewport_h=844,
                ),
                Screen(
                    flow_type=FlowType.join,
                    screen_index=2,
                    flow_step="mobile: final price",
                    image_path="/artifacts/final.png",
                    viewport_w=390,
                    viewport_h=844,
                ),
            ])
            session.add(audit)
            session.flush()
            audit_id = f"audit-{audit.id}"
            initial_element = Element(
                screen=run.screens[0], dom_id="initial-price", element_type="price",
                text="Initial advertised price", bbox_x=0.1, bbox_y=0.3,
                bbox_w=0.4, bbox_h=0.06, source="dom",
            )
            final_element = Element(
                screen=run.screens[1], dom_id="final-price", element_type="price",
                text="Final total price", bbox_x=0.2, bbox_y=0.7,
                bbox_w=0.5, bbox_h=0.08, source="dom",
            )
            session.add_all([initial_element, final_element])
            session.flush()
            candidate = {
                "candidate_id": "DA-15:final:final-price",
                "rule_id": "DA-15",
                "screen_id": "final",
                "screen_index": 2,
                "primary_element_id": "final-price",
                "triggered_checks": ["DA-15.price_increase_across_screens"],
                "measurements": {"initial": 1000, "final": 1500, "delta": 500},
                "related_element_ids": ["initial-price"],
            }
            output = HybridAuditOutput.from_dict(
                {
                    "audit_id": audit_id,
                    "schema_version": "1.1",
                    "screens": [
                        {"screen_id": "initial", "flow_step": "mobile: initial price"},
                        {"screen_id": "final", "flow_step": "mobile: final price"},
                    ],
                    "candidate_decisions": [{
                        "candidate_id": candidate["candidate_id"],
                        "decision": "KEEP",
                        "reason": "The final price is higher than the initial price.",
                        "confidence": 0.94,
                        "base_severity": "HIGH",
                    }],
                    "semantic_findings": [],
                },
                [RuleCandidate.from_dict(candidate)],
            )

            service._store_output(
                session,
                run,
                output,
                [ScoredFinding(
                    rule_id="DA-15", label_unit="flow", screen_index=None,
                    primary_id="final-price", related_ids=["initial-price"],
                    screen_indices=[1, 2],
                )],
                {"initial-price": initial_element, "final-price": final_element},
                [candidate],
            )
            session.commit()

        dashboard = self.client.get("/api/v1/dashboard/summary").json()
        stored_audit = next(item for item in dashboard["audits"] if item["id"] == audit_id)
        finding = stored_audit["findings"][0]
        self.assertEqual(finding["screenIds"], ["screen-01", "screen-02"])
        self.assertEqual(finding["bbox"]["screenId"], "screen-02")
        self.assertEqual(finding["bbox"]["coordinateSystem"], "image")
        self.assertEqual(finding["relatedElements"][0]["bbox"]["screenId"], "screen-01")

    def test_rejects_analysis_without_uploaded_screens(self) -> None:
        audit_id = self.client.post(
            "/api/v1/audits",
            json={"name": "빈 진단", "platform": "desktop-web"},
        ).json()["id"]
        response = self.client.post(f"/api/v1/audits/{audit_id}/analyze")
        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
