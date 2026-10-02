"""평가 스크립트의 후보 생성이 증거 계약을 통과할 수 있는 형태인지 보장한다.

배경: 증거 계약(57ec857)이 후보의 measurements.evidence 를 요구하게 됐지만 평가용
후보에는 이 필드가 없어, 하이브리드 평가에서 DA-03·DA-15 KEEP 이 항상 탈락했다.
"""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ai.pipeline.assessment_contract import EvidenceContractError
from ai.pipeline.response_parser import parse_hybrid_response
from ai.schemas.audit_schema import AuditScreen, LLMAuditRequest, RuleCandidate
from backend import eval_hybrid

FIXTURES = Path(__file__).parent / "fixtures" / "eval_hybrid"


def _element(element_id, element_type, text, bbox, **style):
    return {
        "element_id": element_id,
        "element_type": element_type,
        "text": text,
        "bbox": bbox,
        "state": {},
        "computed_style": {"font_size": 14, "contrast_ratio": 10.0, **style},
    }


def _ui_doc():
    """DA-03(큰 수락/작은 거절)과 DA-15(금액 상승) 후보가 모두 생기는 최소 흐름."""
    screens = []
    for index in range(1, 6):
        elements = []
        if index == 1:
            elements.append(_element("price-first", "price", "월 9,900원", [0.1, 0.3, 0.8, 0.05]))
        if index == 4:
            elements.append(_element("price-last", "price", "월 15,900원", [0.1, 0.3, 0.8, 0.05]))
        if index == 5:
            elements.append(_element(
                "btn-accept", "button", "가입 완료하기", [0.34, 0.89, 0.61, 0.08],
                font_size=16, contrast_ratio=6.6))
            elements.append(_element(
                "btn-decline", "button", "가입하지 않기", [0.05, 0.89, 0.27, 0.08],
                font_size=13, contrast_ratio=1.9))
        screens.append({"screen_index": index, "viewport": {"width": 390, "height": 844},
                        "elements": elements})
    return {"flow_id": "synthetic", "screens": screens}


class CandidatesFromUiTest(unittest.TestCase):
    def test_every_candidate_carries_evidence(self):
        candidates, _ = eval_hybrid.candidates_from_ui("synthetic", _ui_doc())
        rules = {c["rule_id"] for c in candidates}
        self.assertLessEqual({"DA-03", "DA-15"}, rules)
        for candidate in candidates:
            evidence = candidate["measurements"].get("evidence")
            self.assertTrue(evidence, f"{candidate['candidate_id']} 에 measurements.evidence 가 없다")
            for item in evidence:
                self.assertTrue({"screen_id", "element_id", "text", "bbox"} <= set(item))

    def test_da03_evidence_has_both_choice_labels(self):
        candidates, _ = eval_hybrid.candidates_from_ui("synthetic", _ui_doc())
        candidate = next(c for c in candidates if c["rule_id"] == "DA-03")
        texts = {e["element_id"]: e["text"] for e in candidate["measurements"]["evidence"]}
        self.assertEqual(texts["btn-accept"], "가입 완료하기")
        self.assertEqual(texts["btn-decline"], "가입하지 않기")

    def test_da15_evidence_spans_initial_and_final_screens(self):
        candidates, _ = eval_hybrid.candidates_from_ui("synthetic", _ui_doc())
        candidate = next(c for c in candidates if c["rule_id"] == "DA-15")
        screens = {e["screen_id"] for e in candidate["measurements"]["evidence"]}
        self.assertEqual(screens, {"screen-01", "screen-04"})
        self.assertEqual(candidate["screen_id"], "screen-04")

    def test_matches_production_payload_format(self):
        """운영 경로(candidate_payload)와 키·candidate_id 형식이 같다."""
        candidates, _ = eval_hybrid.candidates_from_ui("synthetic", _ui_doc())
        for candidate in candidates:
            self.assertEqual(
                set(candidate),
                {"candidate_id", "rule_id", "screen_id", "screen_index", "primary_element_id",
                 "related_element_ids", "triggered_checks", "measurements"},
            )
            self.assertEqual(
                candidate["candidate_id"],
                f"{candidate['rule_id']}:{candidate['screen_id']}:{candidate['primary_element_id']}",
            )
            RuleCandidate.from_dict(candidate)  # 스키마 검증

    def test_repeated_element_does_not_duplicate_triggered_checks(self):
        doc = _ui_doc()
        for index in (1, 2):  # 같은 체크박스가 두 화면에 반복된다
            doc["screens"][index]["elements"].append(
                _element("agree", "checkbox", "마케팅 수신 동의", [0.1, 0.5, 0.05, 0.03]))
            doc["screens"][index]["elements"][-1]["state"] = {"checked": True}
        candidates, _ = eval_hybrid.candidates_from_ui("synthetic", doc)
        for candidate in candidates:
            checks = candidate["triggered_checks"]
            self.assertEqual(len(checks), len(set(checks)), candidate["candidate_id"])
            RuleCandidate.from_dict(candidate)

    def test_element_lookup_is_per_screen(self):
        doc = _ui_doc()
        for screen in doc["screens"][:2]:  # 같은 element_id 가 두 화면에 반복
            screen["elements"].append(_element("dup", "text", "반복", [0.1, 0.1, 0.1, 0.1]))
        doc["screens"][1]["elements"][-1]["bbox"] = [0.5, 0.5, 0.1, 0.1]
        _, elements = eval_hybrid.candidates_from_ui("synthetic", doc)
        self.assertNotEqual(elements[(1, "dup")]["bbox"], elements[(2, "dup")]["bbox"])


class SavedResponsesPassContractTest(unittest.TestCase):
    """gpt-5.6-luna 가 4개 flow 에서 낸 8개 응답이 수정 후 첫 시도에 통과한다."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls._tmp.cleanup)
        cls.image = Path(cls._tmp.name) / "screen.png"
        Image.new("RGB", (4, 4), "white").save(cls.image)

    def _load(self, path):
        data = json.loads(path.read_text(encoding="utf-8"))
        request = LLMAuditRequest(
            data["flow_id"],
            tuple(AuditScreen(sid, f"화면 {i}", self.image)
                  for i, sid in enumerate(data["screen_ids"], 1)),
        )
        return data, request

    def test_fixtures_present(self):
        self.assertEqual(len(list(FIXTURES.glob("*.json"))), 8)

    def test_pass_on_first_attempt_with_evidence(self):
        for path in sorted(FIXTURES.glob("*.json")):
            with self.subTest(path.name):
                data, request = self._load(path)
                candidates = [RuleCandidate.from_dict(c) for c in data["candidates"]]
                output = parse_hybrid_response(
                    copy.deepcopy(data["raw"]), request, candidates)
                kept = {
                    next(c.rule_id for c in output.candidates if c.candidate_id == d.candidate_id)
                    for d in output.candidate_decisions if d.decision.value == "KEEP"
                }
                raw_kept = {
                    next(c["rule_id"] for c in data["candidates"] if c["candidate_id"] == d["candidate_id"])
                    for d in data["raw"]["candidate_decisions"] if d["decision"] == "KEEP"
                }
                self.assertEqual(kept, raw_kept)

    def test_same_responses_fail_without_evidence(self):
        """evidence 가 비면 DA-03·DA-15 KEEP 은 계약에서 탈락한다(수정 전 상태 재현)."""
        failures = 0
        for path in sorted(FIXTURES.glob("*.json")):
            data, request = self._load(path)
            stripped = copy.deepcopy(data["candidates"])
            for candidate in stripped:
                candidate["measurements"]["evidence"] = []
            candidates = [RuleCandidate.from_dict(c) for c in stripped]
            keeps_03_15 = any(
                d["decision"] == "KEEP" and d["candidate_id"].split(":")[0] in {"DA-03", "DA-15"}
                for d in data["raw"]["candidate_decisions"]
            )
            if not keeps_03_15:
                continue
            with self.assertRaises(EvidenceContractError, msg=path.name):
                parse_hybrid_response(copy.deepcopy(data["raw"]), request, candidates)
            failures += 1
        self.assertGreaterEqual(failures, 6)


if __name__ == "__main__":
    unittest.main()
