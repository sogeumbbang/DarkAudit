import copy
import tempfile
import unittest
from pathlib import Path

from ai.evaluation import Evaluator
from ai.pipeline.baseline import BaselineAuditPipeline
from ai.schemas.audit_schema import AuditScreen, LLMAuditOutput, LLMAuditRequest, SCHEMA_VERSION


GOLDEN_PATH = Path(__file__).with_name("golden_cases.jsonl")


def output(detections=None, screens=None):
    return {
        "audit_id": "audit_1",
        "schema_version": SCHEMA_VERSION,
        "screens": screens or [{"screen_id": "screen_01", "flow_step": "desktop: 부가서비스"}],
        "detections": detections or [],
    }


def hybrid_output(decisions=None, semantic_findings=None, screens=None):
    return {
        "audit_id": "audit_1",
        "schema_version": SCHEMA_VERSION,
        "screens": screens or [{"screen_id": "screen_01", "flow_step": "desktop: offer"}],
        "candidate_decisions": decisions or [],
        "semantic_findings": semantic_findings or [],
    }


def detection(
    risk_type="EMOTIONAL_LANGUAGE",
    risk_name="감정적 언어",
    rule_id="DA-12",
    severity="REVIEW",
    screen_ids=None,
    bbox=None,
    related_elements=None,
):
    return {
        "risk_type": risk_type,
        "risk_name": risk_name,
        "where": {
            "screen_ids": screen_ids or ["screen_01"],
            "element": "혜택을 포기할래요 버튼",
            "location": "화면 하단",
        },
        "bbox": bbox or [0.08, 0.72, 0.84, 0.10],
        "related_elements": related_elements or [],
        "what": "감정적 거절 문구",
        "observation": "거절 버튼에 혜택 포기라는 문구가 표시됨",
        "rule_id": rule_id,
        "why": "거절에 손실 프레이밍을 사용함",
        "severity": severity,
        "confidence": 0.9,
        "fix": "거절 문구를 중립적으로 바꾼다.",
    }


def da15(screen_ids):
    return detection(
        risk_type="SEQUENTIAL_PRICE_DISCLOSURE",
        risk_name="순차공개 가격책정",
        rule_id="DA-15",
        severity="HIGH",
        screen_ids=screen_ids,
        bbox=[0.10, 0.20, 0.40, 0.08],
        related_elements=[{
            "screen_id": screen_ids[0],
            "element": "최초 표시 가격",
            "bbox": [0.10, 0.20, 0.40, 0.08],
        }],
    )


def da07():
    return detection(
        risk_type="HIDDEN_INFORMATION",
        risk_name="숨겨진 정보",
        rule_id="DA-07",
        severity="HIGH",
    )


class FakeProvider:
    def __init__(self, result):
        self.result, self.rules, self.candidates, self.output_schema = result, None, None, None
        self.audit_prompt = None

    def analyze(self, request, system_prompt, audit_prompt, rules, output_schema, candidates=None):
        self.audit_prompt = audit_prompt
        self.rules = rules
        self.candidates = candidates
        self.output_schema = output_schema
        return self.result


class RetryProvider(FakeProvider):
    def __init__(self, result):
        super().__init__(result)
        self.calls = 0
        self.audit_prompts = []

    def analyze(self, *args, **kwargs):
        self.calls += 1
        self.audit_prompts.append(kwargs.get("audit_prompt", args[2] if len(args) > 2 else ""))
        if self.calls == 1:
            return {"invalid": True}
        return super().analyze(*args, **kwargs)


class AuditSchemaTest(unittest.TestCase):
    def test_valid_empty_contract(self):
        self.assertEqual(LLMAuditOutput.from_dict(output()).detections, ())

    def test_severity_is_rule_base_base_severity(self):
        invalid_da12 = detection(severity="HIGH")
        invalid_da03 = detection(
            risk_type="VISUAL_HIERARCHY_DISTORTION",
            risk_name="잘못된 계층구조",
            rule_id="DA-03",
            severity="REVIEW",
            related_elements=[{
                "screen_id": "screen_01",
                "element": "다음에 하기 버튼",
                "bbox": [0.08, 0.86, 0.84, 0.06],
            }],
        )
        for item in (invalid_da12, invalid_da03):
            with self.subTest(rule_id=item["rule_id"]), self.assertRaises(ValueError):
                LLMAuditOutput.from_dict(output([item]))

    def test_rejects_bbox_outside_normalized_screen(self):
        item = detection(bbox=[0.8, 0.2, 0.3, 0.1])
        with self.assertRaisesRegex(ValueError, "inside the screen"):
            LLMAuditOutput.from_dict(output([item]))

    def test_da03_requires_distinct_related_element_pair(self):
        item = detection(
            risk_type="VISUAL_HIERARCHY_DISTORTION",
            risk_name="잘못된 계층구조",
            rule_id="DA-03",
            severity="HIGH",
        )
        with self.assertRaisesRegex(ValueError, "counterpart"):
            LLMAuditOutput.from_dict(output([item]))

    def test_golden_allows_multiple_rule_labels_on_same_element(self):
        golden = Evaluator.load_golden(GOLDEN_PATH)
        case = next(item for item in golden if item["case_id"] == "multi-label-same-element")
        parsed = LLMAuditOutput.from_dict(case["expected_output"])

        self.assertEqual(
            {item.rule_id for item in parsed.detections},
            set(case["expected_rule_ids"]),
        )
        self.assertEqual(len({item.bbox for item in parsed.detections}), 1)
        da03_finding = next(item for item in parsed.detections if item.rule_id == "DA-03")
        self.assertGreaterEqual(len(da03_finding.related_elements), 1)

    def test_da15_accepts_only_same_device_profile(self):
        same_profile_screens = [
            {"screen_id": "screen_01", "flow_step": "mobile: 상품 목록"},
            {"screen_id": "screen_02", "flow_step": "mobile: 최종 확인"},
        ]
        parsed = LLMAuditOutput.from_dict(output([da15(["screen_01", "screen_02"])], same_profile_screens))
        self.assertEqual(parsed.detections[0].rule_id, "DA-15")

        cross_profile_screens = copy.deepcopy(same_profile_screens)
        cross_profile_screens[1]["flow_step"] = "desktop: 최종 확인"
        with self.assertRaisesRegex(ValueError, "same device profile"):
            LLMAuditOutput.from_dict(output([da15(["screen_01", "screen_02"])], cross_profile_screens))

    def test_da07_risk_mapping_and_base_severity(self):
        parsed = LLMAuditOutput.from_dict(output([da07()]))
        self.assertEqual(parsed.detections[0].risk_type.value, "HIDDEN_INFORMATION")
        self.assertEqual(parsed.detections[0].risk_name, "숨겨진 정보")
        self.assertEqual(parsed.detections[0].severity.value, "HIGH")

    def test_baseline_passes_only_mvp_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest("audit_1", (AuditScreen("screen_01", "desktop: 부가서비스", image),))
            provider = FakeProvider(hybrid_output(
                screens=[{"screen_id": "screen_01", "flow_step": request.screens[0].flow_step}]
            ))
            result = BaselineAuditPipeline(provider).analyze(request)
            self.assertEqual(result.audit_id, "audit_1")
            self.assertEqual(
                {rule["rule_id"] for rule in provider.rules},
                {"DA-03", "DA-04", "DA-07", "DA-12", "DA-15"},
            )
            self.assertEqual(provider.candidates, [])
            properties = provider.output_schema["properties"]
            self.assertIn("candidate_decisions", properties)
            self.assertIn("semantic_findings", properties)
            self.assertNotIn("detections", properties)

    def test_returns_one_decision_for_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest("audit_1", (AuditScreen("screen_01", "desktop: offer", image),))
            candidate_id = "DA-12:screen_01:decline"
            provider = FakeProvider(hybrid_output([{
                "candidate_id": candidate_id,
                "decision": "KEEP",
                "reason": "The decline text uses loss framing",
                "confidence": 0.91,
                "base_severity": "REVIEW",
            }]))
            result = BaselineAuditPipeline(provider).analyze(request, [{
                "candidate_id": candidate_id, "rule_id": "DA-12",
                "screen_id": "screen_01", "screen_index": 1,
                "primary_element_id": "decline",
                "triggered_checks": ["DA-12.loss_framed_decline"],
                "measurements": {"matches": 1}, "related_element_ids": [],
            }])
            self.assertEqual(result.candidate_decisions[0].candidate_id, candidate_id)
            self.assertEqual(provider.candidates[0]["measurements"], {"matches": 1})

    def test_weak_semantic_only_and_duplicate_findings_are_filtered(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest("audit_1", (AuditScreen("screen_01", "desktop: offer", image),))
            weak = detection()
            weak["confidence"] = 0.69
            strong = detection()
            strong["confidence"] = 0.91
            provider = FakeProvider(hybrid_output(
                semantic_findings=[weak, strong, copy.deepcopy(strong)],
                screens=[{"screen_id": "screen_01", "flow_step": "desktop: offer"}],
            ))
            result = BaselineAuditPipeline(provider).analyze(request)
            self.assertEqual(len(result.semantic_findings), 1)
            self.assertEqual(result.semantic_findings[0].confidence, 0.91)

    def test_screenshot_visual_fallback_allows_preselected_option(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest(
                "audit_1", (AuditScreen("screen_01", "유료 옵션 선택", image),)
            )
            finding = detection(
                risk_type="PRESELECTED_OPTION",
                risk_name="특정옵션의 사전선택",
                rule_id="DA-04",
                severity="HIGH",
            )
            provider = FakeProvider(
                hybrid_output(
                    semantic_findings=[finding],
                    screens=[{"screen_id": "screen_01", "flow_step": "유료 옵션 선택"}],
                )
            )
            result = BaselineAuditPipeline(
                provider, allow_visual_fallback=True
            ).analyze(request)
            self.assertEqual(result.semantic_findings[0].rule_id, "DA-04")
            self.assertIn("스크린샷 전용 시각 판정", provider.audit_prompt)

    def test_wrong_severity_is_corrected_instead_of_failing_the_run(self):
        """
        severity 와 risk_name 은 risk_type 만으로 결정되는 조회표 값이라 모델
        답변에 정보가 없다. 상수 하나가 틀렸다고 진단 전체를 버리면 안 된다.
        실제 배포에서 이 이유로 분석이 실패했다.
        """
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest(
                "audit_1", (AuditScreen("screen_01", "약관 동의", image),)
            )
            wrong = detection(screen_ids=["screen_01"])
            wrong["severity"] = "HIGH"  # DA-12 의 Rule Base 값은 REVIEW 다
            wrong["risk_name"] = "감정 자극"  # 조회표 값과 다른 이름
            provider = FakeProvider(
                hybrid_output(
                    semantic_findings=[wrong],
                    screens=[{"screen_id": "screen_01", "flow_step": "약관 동의"}],
                )
            )

            result = BaselineAuditPipeline(provider).analyze(request)

            finding = result.semantic_findings[0]
            self.assertEqual(finding.rule_id, "DA-12")
            self.assertEqual(finding.severity.value, "REVIEW")
            self.assertEqual(finding.risk_name, "감정적 언어")

    def test_url_source_drops_disallowed_semantic_finding_instead_of_failing(self):
        """
        URL 캡처 경로에서는 deterministic 규칙(DA-04)을 semantic_findings 에 직접
        넣을 수 없다. 모델이 이를 어겨도 실행 전체가 실패하면 안 된다 — 실제
        배포에서 내용이 있는 페이지가 이 이유로 통째로 실패했다.
        """
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest(
                "audit_1", (AuditScreen("screen_01", "유료 옵션 선택", image),)
            )
            disallowed = detection(
                risk_type="PRESELECTED_OPTION",
                risk_name="특정옵션의 사전선택",
                rule_id="DA-04",
                severity="HIGH",
            )
            allowed = detection(screen_ids=["screen_01"])
            provider = FakeProvider(
                hybrid_output(
                    semantic_findings=[disallowed, allowed],
                    screens=[{"screen_id": "screen_01", "flow_step": "유료 옵션 선택"}],
                )
            )
            pipeline = BaselineAuditPipeline(provider)  # allow_visual_fallback=False

            result = pipeline.analyze(request)

            # 허용된 것만 남고, 버린 사실은 텔레메트리로 확인할 수 있어야 한다.
            self.assertEqual([f.rule_id for f in result.semantic_findings], ["DA-12"])
            self.assertEqual(
                pipeline.last_run_telemetry["dropped_semantic_rule_ids"], ["DA-04"]
            )
            # 재시도 없이 첫 응답으로 끝나야 한다.
            self.assertEqual(pipeline.last_run_telemetry["schema_retries"], 0)

    def test_records_schema_retry_and_latency_telemetry(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest("audit_1", (AuditScreen("screen_01", "desktop: offer", image),))
            provider = RetryProvider(hybrid_output(screens=[{"screen_id": "screen_01", "flow_step": "desktop: offer"}]))
            pipeline = BaselineAuditPipeline(provider)
            pipeline.analyze(request)
            self.assertEqual(pipeline.last_run_telemetry["schema_attempts"], 2)
            self.assertEqual(pipeline.last_run_telemetry["schema_retries"], 1)
            self.assertGreaterEqual(pipeline.last_run_telemetry["response_time_seconds"], 0)
            self.assertIn("invalid HybridAuditOutput fields", provider.audit_prompts[1])

    def test_final_validation_error_includes_root_cause(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            request = LLMAuditRequest(
                "audit_1", (AuditScreen("screen_01", "desktop: offer", image),)
            )
            provider = FakeProvider({"invalid": True})
            with self.assertRaisesRegex(
                ValueError,
                "Model output failed validation after 2 attempts: invalid HybridAuditOutput fields",
            ):
                BaselineAuditPipeline(provider).analyze(request)


if __name__ == "__main__":
    unittest.main()
