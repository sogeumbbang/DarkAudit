import copy
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ai.pipeline.assessment_contract import EvidenceContractError
from ai.pipeline.baseline import BaselineAuditPipeline
from ai.pipeline.response_parser import parse_hybrid_response
from ai.schemas.audit_schema import (
    AuditScreen,
    LLMAuditRequest,
    RULE_BASE_SEVERITY,
    VISUAL_FALLBACK_RULE_IDS,
)
from ai.tests.test_audit_schema import da15, detection
from ai.vision.candidate_grounding import ground_selected_control_bbox


def assessments(ids):
    return [
        {
            "rule_id": rule,
            "status": "not_detected",
            "reason": "검토한 화면에서 근거 없음",
            "screen_ids": ids,
            "checks": [],
            "choice_pairs": [],
            "price_comparisons": [],
        }
        for rule in sorted(RULE_BASE_SEVERITY)
    ]


class AssessmentContractTest(unittest.TestCase):
    def test_current_golden_empty_result_has_complete_rule_coverage(self):
        from dataclasses import replace

        case = json.loads(
            Path(__file__).with_name("golden_cases.jsonl").read_text().splitlines()[0]
        )
        request = LLMAuditRequest(
            "golden-empty",
            (
                replace(
                    self.request.screens[0],
                    screen_id="home",
                    flow_step="desktop: 상품 안내",
                ),
            ),
        )
        result = parse_hybrid_response(
            case["expected_hybrid_output"], request, [], VISUAL_FALLBACK_RULE_IDS
        )
        self.assertEqual(len(result.rule_assessments), 5)

    def test_detected_rule_does_not_hide_incomplete_other_batch(self):
        from ai.pipeline.quality import summarize

        first, second = assessments(["a"]), assessments(["b"])
        first[0]["status"] = "detected"
        second[0]["status"] = "insufficient_evidence"
        result = summarize(
            {
                "batches": [
                    {"screens": ["a"], "telemetry": {"rule_assessments": first}},
                    {"screens": ["b"], "telemetry": {"rule_assessments": second}},
                ]
            }
        )
        self.assertFalse(result["complete"])
        self.assertEqual(result["ruleAssessments"][0]["status"], "detected")

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "screen.png"
        Image.new("RGB", (400, 800), "white").save(path)
        self.request = LLMAuditRequest(
            "audit",
            (
                AuditScreen("screen_01", "mobile: first", path, "mobile", state_id="1"),
                AuditScreen("screen_02", "mobile: last", path, "mobile", state_id="2"),
            ),
        )
        self.raw = {
            "audit_id": "audit",
            "schema_version": self.request.schema_version,
            "screens": [
                {"screen_id": s.screen_id, "flow_step": s.flow_step}
                for s in self.request.screens
            ],
            "candidate_decisions": [],
            "semantic_findings": [],
            "rule_assessments": assessments(["screen_01", "screen_02"]),
        }

    def parse(self):
        return parse_hybrid_response(
            self.raw, self.request, [], VISUAL_FALLBACK_RULE_IDS
        )

    def add_price(self):
        self.raw["semantic_findings"] = [da15(["screen_01", "screen_02"])]
        review = self.raw["rule_assessments"][-1]
        review.update(
            status="detected",
            checks=["late_mandatory_cost"],
            price_comparisons=[
                {
                    "product": "insurance",
                    "initial_screen_id": "screen_01",
                    "final_screen_id": "screen_02",
                    "unit": "KRW",
                    "initial_amount": 9900,
                    "final_amount": 14400,
                    "same_product": True,
                    "explained_by_user_choice": False,
                    "initially_disclosed": False,
                }
            ],
        )
        return review["price_comparisons"][0]

    def test_every_rule_and_screen_must_be_assessed(self):
        self.parse()
        self.raw["rule_assessments"].pop()
        with self.assertRaisesRegex(ValueError, "five MVP"):
            self.parse()

    def test_price_free_preselection_uses_existing_yaml_checks(self):
        from ai.rules.rule_loader import RuleLoader

        rule = RuleLoader().rules(rule_ids={"DA-04"})[0]
        item = detection(
            risk_type="PRESELECTED_OPTION",
            risk_name="특정옵션의 사전선택",
            rule_id="DA-04",
            severity="HIGH",
        )
        item["where"]["element"] = "[선택] 마케팅 정보 수신"
        item["observation"] = (
            "첫 설정 화면의 선택 마케팅 동의 체크박스가 체크되어 있다."
        )
        self.raw["semantic_findings"] = [item]
        for check in rule["deterministic_checks"]:
            self.raw["rule_assessments"][1].update(
                status="detected", checks=[check["id"]]
            )
            with self.subTest(check=check["id"]):
                self.assertEqual(self.parse().semantic_findings[0].rule_id, "DA-04")

    def test_optional_consent_mandatory_presentation_does_not_need_fake_decline_button(
        self,
    ):
        item = detection(
            risk_type="VISUAL_HIERARCHY_DISTORTION",
            risk_name="잘못된 계층구조",
            rule_id="DA-03",
            severity="HIGH",
            related_elements=[
                {
                    "screen_id": "screen_01",
                    "element": "모두 필수 동의",
                    "bbox": [0.1, 0.1, 0.6, 0.1],
                }
            ],
        )
        item["where"]["element"] = "[선택] 마케팅 동의"
        self.raw["semantic_findings"] = [item]
        self.raw["rule_assessments"][0].update(
            status="detected",
            checks=["optional_looks_mandatory"],
            choice_pairs=[
                {
                    "screen_id": "screen_01",
                    "accept_text": "[선택] 마케팅 동의",
                    "decline_text": "모두 필수 동의",
                    "decline_is_action": False,
                    "pair_kind": "optional_as_required",
                }
            ],
        )
        self.parse()
        self.raw["rule_assessments"][0]["choice_pairs"][0]["pair_kind"] = (
            "opposing_choices"
        )
        with self.assertRaises(EvidenceContractError):
            self.parse()

    def test_cost_rate_increase_and_return_rate_decrease_are_both_adverse(self):
        price = self.add_price()
        price.update(unit="percent_cost", initial_amount=4, final_amount=8)
        self.parse()
        price.update(unit="percent_return")
        with self.assertRaises(EvidenceContractError):
            self.parse()
        price.update(initial_amount=8, final_amount=4)
        self.parse()

    def test_invalid_choice_does_not_remove_valid_finding_of_the_same_rule(self):
        items, pairs = [], []
        for index in (1, 2):
            screen_id = f"screen_0{index}"
            item = detection(
                risk_type="VISUAL_HIERARCHY_DISTORTION",
                risk_name="잘못된 계층구조",
                rule_id="DA-03",
                severity="HIGH",
                screen_ids=[screen_id],
                related_elements=[
                    {
                        "screen_id": screen_id,
                        "element": "나중에",
                        "bbox": [0.1, 0.1, 0.3, 0.05],
                    }
                ],
            )
            item["where"]["element"] = "신청하기"
            items.append(item)
            pairs.append(
                {
                    "screen_id": screen_id,
                    "accept_text": "신청하기",
                    "decline_text": "나중에",
                    "decline_is_action": index == 1,
                    "pair_kind": "opposing_choices",
                }
            )
        self.raw["semantic_findings"] = items
        self.raw["rule_assessments"][0].update(
            status="detected", checks=["visual_hierarchy"], choice_pairs=pairs
        )
        raw = self.raw

        class Provider:
            requires_rule_assessments = True

            def analyze(self, **kwargs):
                return copy.deepcopy(raw)

        pipeline = BaselineAuditPipeline(Provider(), allow_visual_fallback=True)
        result = pipeline.analyze(self.request)
        self.assertEqual(len(result.semantic_findings), 1)
        self.assertEqual(result.semantic_findings[0].where.screen_ids, ("screen_01",))
        self.assertEqual(result.rule_assessments[0]["status"], "detected")
        self.assertEqual(len(pipeline.last_run_telemetry["rejected_evidence"]), 1)
        self.assertIn(
            "evidence_contract:DA-03", pipeline.last_run_telemetry["warnings"]
        )

    def test_rejects_cross_product_and_explained_price_changes(self):
        price = self.add_price()
        self.parse()
        for key in ["same_product", "explained_by_user_choice", "initially_disclosed"]:
            with self.subTest(key=key):
                original = price[key]
                price[key] = not original
                with self.assertRaises(EvidenceContractError):
                    self.parse()
                price[key] = original
        price["unit"] = "percent"
        with self.assertRaises(EvidenceContractError):
            self.parse()

    def test_crops_of_one_state_do_not_prove_price_progression(self):
        self.add_price()
        from dataclasses import replace

        self.request = replace(
            self.request,
            screens=tuple(replace(s, state_id="same") for s in self.request.screens),
        )
        with self.assertRaisesRegex(EvidenceContractError, "different states"):
            self.parse()

    def test_da03_keep_requires_opposing_actions_in_original_candidate_evidence(self):
        from ai.schemas.audit_schema import RuleCandidate

        candidate = RuleCandidate(
            "choice",
            "DA-03",
            "screen_01",
            1,
            "accept",
            ("DA-03.primary_vs_secondary_area_ratio",),
            {
                "evidence": [
                    {"element_id": "accept", "screen_id": "screen_01", "text": "동의"},
                    {"element_id": "decline", "screen_id": "screen_01", "text": "거절"},
                ]
            },
            ("decline",),
        )
        self.raw["candidate_decisions"] = [
            {
                "candidate_id": "choice",
                "decision": "KEEP",
                "reason": "실제 대립 선택지 확인",
                "base_severity": "HIGH",
                "confidence": 0.9,
            }
        ]
        self.raw["rule_assessments"][0].update(
            status="detected",
            checks=["visual_hierarchy"],
            choice_pairs=[
                {
                    "screen_id": "screen_01",
                    "accept_text": "동의",
                    "decline_text": "거절",
                    "decline_is_action": True,
                }
            ],
        )
        parse_hybrid_response(
            self.raw, self.request, [candidate], VISUAL_FALLBACK_RULE_IDS
        )
        self.raw["rule_assessments"][0]["choice_pairs"][0]["decline_text"] = (
            "혜택이 사라집니다"
        )
        with self.assertRaisesRegex(EvidenceContractError, "opposing actions"):
            parse_hybrid_response(
                self.raw, self.request, [candidate], VISUAL_FALLBACK_RULE_IDS
            )

    def test_failed_evidence_rule_is_marked_incomplete_without_losing_other_rules(self):
        price = self.add_price()
        price["same_product"] = False
        self.raw["semantic_findings"].append(detection())
        emotional = self.raw["rule_assessments"][3]
        emotional.update(status="detected", checks=["loss_framed_decline"])
        raw = self.raw

        class Provider:
            requires_rule_assessments = True
            last_usage = {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}

            def analyze(self, **kwargs):
                return copy.deepcopy(raw)

        pipeline = BaselineAuditPipeline(Provider(), allow_visual_fallback=True)
        output = pipeline.analyze(self.request)
        self.assertEqual([f.rule_id for f in output.semantic_findings], ["DA-12"])
        self.assertEqual(pipeline.last_run_telemetry["usage"]["total_tokens"], 24)
        self.assertEqual(output.rule_assessments[-1]["status"], "insufficient_evidence")
        self.assertIn(
            "evidence_contract:DA-15", pipeline.last_run_telemetry["warnings"]
        )

    def test_verifier_failure_keeps_original_bbox_and_exposes_failure(self):
        path = (
            Path(__file__).resolve().parents[2]
            / "frontend/public/sample-audit/02-preselected-addon.png"
        )
        original = (0.1, 0.34, 0.1, 0.08)

        def failure(*args):
            raise RuntimeError("invalid schema")

        result = ground_selected_control_bbox(
            path, original, "안심케어", selector=failure, ocr_anchors=[]
        )
        self.assertEqual(result.bbox, original)
        self.assertEqual(result.warning, "bbox_verification_failed:RuntimeError")
        self.assertEqual(result.confidence, 0)
