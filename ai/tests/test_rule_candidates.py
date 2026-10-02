"""운영 경로 후보 payload(candidate_payload)가 스키마를 통과하는지 확인한다."""

import unittest
from pathlib import Path

from ai.browser.models import CaptureArtifact
from ai.pipeline.rule_candidates import candidate_payload, run_artifact_rules
from ai.schemas.audit_schema import RuleCandidate


def _element(element_id, element_type, text, bbox, state=None, **style):
    return {
        "element_id": element_id,
        "element_type": element_type,
        "text": text,
        "bbox": bbox,
        "state": state or {},
        "computed_style": {"font_size": 14, "contrast_ratio": 10.0, **style},
    }


def _artifact(index, elements):
    return CaptureArtifact(
        screen_id=f"mobile_{index:02d}",
        flow_step=f"mobile: step {index}",
        profile="mobile",
        url=f"https://example.test/?step={index}",
        title="demo",
        image_path=Path(f"{index:02d}.png"),
        viewport_width=390,
        viewport_height=844,
        dom_elements=tuple(elements),
        state_id=str(index),
    )


def _repeated_checkbox():
    return _element("agree", "checkbox", "마케팅 수신 동의", [0.1, 0.5, 0.05, 0.03],
                    state={"checked": True})


class CandidatePayloadTest(unittest.TestCase):
    def test_repeated_element_across_screens_yields_unique_triggered_checks(self):
        """같은 사전선택 체크박스가 두 화면에 반복돼도 후보가 스키마를 통과한다."""
        indices = [1, 2, 3]
        # 실제 데이터(ins-001-risky)처럼 같은 id 의 요소가 한 화면에 두 번, 다른 화면에도 나온다.
        screens = {1: [_repeated_checkbox()], 2: [_repeated_checkbox(), _repeated_checkbox()], 3: []}
        artifacts = tuple(_artifact(i, screens[i]) for i in indices)
        findings = run_artifact_rules("audit-1", indices, artifacts)
        payload = candidate_payload(findings, indices, artifacts)

        self.assertTrue(any(c["rule_id"] == "DA-04" for c in payload))
        for candidate in payload:
            checks = candidate["triggered_checks"]
            self.assertEqual(len(checks), len(set(checks)), candidate["candidate_id"])
            RuleCandidate.from_dict(candidate)

    def test_checks_keep_first_seen_order_and_rule_prefix(self):
        artifacts = (_artifact(1, [_repeated_checkbox()]),)
        findings = run_artifact_rules("audit-1", [1], artifacts)
        payload = candidate_payload(findings, [1], artifacts)
        candidate = next(c for c in payload if c["rule_id"] == "DA-04")
        self.assertEqual(candidate["triggered_checks"], ["DA-04.default_checked"])


if __name__ == "__main__":
    unittest.main()
