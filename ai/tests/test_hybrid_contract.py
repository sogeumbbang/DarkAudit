import json
import unittest
from pathlib import Path

from ai.schemas.audit_schema import (
    CandidateDecision,
    CandidateDecisionValue,
    HybridAuditOutput,
    RuleCandidate,
    SCHEMA_VERSION,
    SEMANTIC_ONLY_CHECKS_BY_RULE,
    Severity,
)


def candidate(
    candidate_id="DA-04:screen-01:btn-1", rule_id="DA-04", primary_element_id="btn-1",
    triggered_checks=None, measurements=None,
):
    return RuleCandidate(
        candidate_id=candidate_id,
        rule_id=rule_id,
        screen_id="screen-01",
        screen_index=1,
        primary_element_id=primary_element_id,
        triggered_checks=tuple(triggered_checks or (f"{rule_id}.default_checked",)),
        measurements={"checked": True} if measurements is None else measurements,
        related_element_ids=(),
    )


def decision(
    candidate_id="DA-04:screen-01:btn-1",
    severity=Severity.HIGH,
    value="KEEP",
):
    return {
        "candidate_id": candidate_id,
        "decision": value,
        "reason": "선택 가능한 옵션이 초기 상태에서 선택되어 있음",
        "confidence": 0.91,
        "base_severity": severity.value,
    }


def output(decisions):
    return {
        "audit_id": "audit-1",
        "schema_version": SCHEMA_VERSION,
        "screens": [{"screen_id": "screen-01", "flow_step": "mobile: option"}],
        "candidate_decisions": decisions,
        "semantic_findings": [],
    }


def da04_semantic_finding():
    return {
        "risk_type": "PRESELECTED_OPTION",
        "risk_name": "특정옵션의 사전선택",
        "where": {"screen_ids": ["screen-01"], "element": "선택 옵션", "location": "화면 중앙"},
        "bbox": [0.1, 0.2, 0.2, 0.1],
        "related_elements": [],
        "what": "사전 선택",
        "observation": "초기 상태에서 선택됨",
        "rule_id": "DA-04",
        "why": "소비자에게 불리한 기본값",
        "severity": "HIGH",
        "confidence": 0.9,
        "fix": "미선택 상태로 변경",
    }


class HybridContractTest(unittest.TestCase):
    def test_accepts_one_decision_for_every_candidate(self):
        parsed = HybridAuditOutput.from_dict(output([decision()]), [candidate()])
        self.assertEqual(parsed.candidate_decisions[0].decision, CandidateDecisionValue.KEEP)
        self.assertNotIn("candidates", parsed.to_dict())

    def test_accepts_reject_decision(self):
        parsed = HybridAuditOutput.from_dict(
            output([decision(value="REJECT")]),
            [candidate()],
        )
        self.assertEqual(parsed.candidate_decisions[0].decision, CandidateDecisionValue.REJECT)

    def test_accepts_multiple_candidates_for_same_rule_and_screen(self):
        first_id = "DA-04:screen-01:btn-1"
        second_id = "DA-04:screen-01:btn-2"
        parsed = HybridAuditOutput.from_dict(
            output([
                decision(first_id, value="KEEP"),
                decision(second_id, value="REJECT"),
            ]),
            [
                candidate(first_id, primary_element_id="btn-1"),
                candidate(second_id, primary_element_id="btn-2"),
            ],
        )
        self.assertEqual(
            [item.candidate_id for item in parsed.candidate_decisions],
            [first_id, second_id],
        )
        self.assertEqual(
            [item.decision for item in parsed.candidate_decisions],
            [CandidateDecisionValue.KEEP, CandidateDecisionValue.REJECT],
        )

    def test_rejects_duplicate_candidate_ids(self):
        with self.assertRaisesRegex(ValueError, "candidate_id values must be unique"):
            HybridAuditOutput.from_dict(output([decision()]), [candidate(), candidate()])

    def test_rejects_missing_candidate_decision(self):
        with self.assertRaisesRegex(ValueError, "missing candidate decisions"):
            HybridAuditOutput.from_dict(output([]), [candidate()])

    def test_rejects_unknown_candidate_decision(self):
        with self.assertRaisesRegex(ValueError, "unknown candidate_id"):
            HybridAuditOutput.from_dict(output([decision("unknown")]), [candidate()])

    def test_rejects_duplicate_candidate_decisions(self):
        with self.assertRaisesRegex(ValueError, "duplicate candidate decision"):
            HybridAuditOutput.from_dict(output([decision(), decision()]), [candidate()])

    def test_rejects_base_severity_different_from_rule_base(self):
        with self.assertRaisesRegex(ValueError, "base_severity does not match"):
            HybridAuditOutput.from_dict(output([decision(severity=Severity.REVIEW)]), [candidate()])

    def test_accepts_da07_candidate_with_high_base_severity(self):
        candidate_id = "DA-07:screen-01:disclosure"
        parsed = HybridAuditOutput.from_dict(
            output([decision(candidate_id, severity=Severity.HIGH)]),
            [candidate(candidate_id, rule_id="DA-07", primary_element_id="disclosure")],
        )
        self.assertEqual(parsed.candidate_decisions[0].base_severity, Severity.HIGH)

    def test_semantic_only_policy_contains_only_agreed_checks(self):
        self.assertEqual(
            SEMANTIC_ONLY_CHECKS_BY_RULE,
            {
                "DA-03": frozenset({"DA-03.optional_looks_mandatory"}),
                "DA-12": frozenset({
                    "DA-12.loss_framed_decline",
                    "DA-12.trivializing_expression",
                }),
            },
        )

    def test_rejects_da07_skippable_keep_without_interaction_evidence(self):
        candidate_id = "DA-07:screen-01:next"
        da07_candidate = candidate(
            candidate_id,
            rule_id="DA-07",
            primary_element_id="next",
            triggered_checks=("DA-07.skippable_without_confirm",),
            measurements={"interaction_evidence": False},
        )
        with self.assertRaisesRegex(ValueError, "requires interaction_evidence=true"):
            HybridAuditOutput.from_dict(output([decision(candidate_id)]), [da07_candidate])

    def test_accepts_da07_skippable_reject_without_interaction_evidence(self):
        candidate_id = "DA-07:screen-01:next"
        da07_candidate = candidate(
            candidate_id,
            rule_id="DA-07",
            primary_element_id="next",
            triggered_checks=("DA-07.skippable_without_confirm",),
            measurements={},
        )
        parsed = HybridAuditOutput.from_dict(
            output([decision(candidate_id, value="REJECT")]),
            [da07_candidate],
        )
        self.assertEqual(parsed.candidate_decisions[0].decision, CandidateDecisionValue.REJECT)

    def test_accepts_da07_skippable_keep_with_interaction_evidence(self):
        candidate_id = "DA-07:screen-01:next"
        da07_candidate = candidate(
            candidate_id,
            rule_id="DA-07",
            primary_element_id="next",
            triggered_checks=("DA-07.skippable_without_confirm",),
            measurements={"interaction_evidence": True},
        )
        parsed = HybridAuditOutput.from_dict(output([decision(candidate_id)]), [da07_candidate])
        self.assertEqual(parsed.candidate_decisions[0].decision, CandidateDecisionValue.KEEP)

    def test_rejects_new_finding_for_non_semantic_only_rule(self):
        raw = output([decision()])
        raw["semantic_findings"] = [da04_semantic_finding()]
        with self.assertRaisesRegex(ValueError, "semantic-only rules"):
            HybridAuditOutput.from_dict(raw, [candidate()])

    def test_contract_schema_files_are_valid_json(self):
        root = Path("ai/schemas")
        candidate_schema = json.loads((root / "rule_candidate.schema.json").read_text(encoding="utf-8"))
        output_schema = json.loads((root / "hybrid_audit_output.schema.json").read_text(encoding="utf-8"))
        provider_schema = json.loads((root / "audit_output.schema.json").read_text(encoding="utf-8"))
        self.assertIn("candidate_id", candidate_schema["required"])
        self.assertIn("candidate_decisions", output_schema["required"])
        self.assertIn("semantic_findings", output_schema["required"])
        self.assertIn("DA-07", provider_schema["$defs"]["detection"]["properties"]["rule_id"]["enum"])
        self.assertIn(
            "HIDDEN_INFORMATION",
            provider_schema["$defs"]["detection"]["properties"]["risk_type"]["enum"],
        )

    def test_da07_prompt_requires_material_information_and_interaction_evidence(self):
        prompt = Path("ai/prompts/audit_v1.md").read_text(encoding="utf-8")
        self.assertIn("DA-07", prompt)
        self.assertIn("footer", prompt)
        dom = Path("ai/prompts/dom.md").read_text(encoding="utf-8")
        self.assertIn("interaction_evidence=true", dom)
        self.assertIn("DA-04·DA-07·DA-15", dom)
        self.assertNotIn("DA-07을 새 `semantic_findings`로 생성하지 않는다", prompt)


if __name__ == "__main__":
    unittest.main()
