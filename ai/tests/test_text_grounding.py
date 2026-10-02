"""DA-07·DA-12 텍스트 근거 기반 위치 보정."""

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ai.pipeline.baseline import BaselineAuditPipeline
from ai.providers.fake_provider import FakeMultimodalProvider
from ai.schemas.audit_schema import (
    AuditScreen,
    Detection,
    DetectionLocation,
    HybridAuditOutput,
    LLMAuditRequest,
    RISK_NAME_MAP,
    RiskType,
    ScreenReference,
    Severity,
)
from ai.vision.candidate_grounding import OCRAnchor
from ai.vision.ocr import NullOCR, OCRResult, OCRTextBlock
from ai.vision.text_grounding import (
    METHOD_MODEL_FALLBACK,
    METHOD_OCR_FUZZY,
    METHOD_PARAGRAPH_SELECT,
    TextGroundingConfig,
    build_text_candidates,
    expand_to_paragraph,
    extract_text_anchors,
    finding_quotes,
    ground_text_finding,
    match_quote,
    union_bbox,
)

CFG = TextGroundingConfig()
PARAGRAPH = "청약 후 15일 이내 청약철회가 가능하며, 보험금 지급사유 발생 시 약관에 따라 지급이 제한될 수 있습니다."


def line(text, x, y, w, h=0.014, confidence=0.9):
    return OCRAnchor(text, (x, y, w, h), confidence)


def faint_paragraph():
    """OCR 이 글자 사이를 띄우고 일부를 틀리게 읽은 두 줄 문단(y≈0.495)."""
    return [
        line("청약 후 15 일 이내 청 약 절 회 가 가 능 하 며 , 보험금 지 급 사유 발생 시", 0.049, 0.497, 0.9),
        line("약 관 에 따라 지 급 이 제 한 될 수 있습니다.", 0.049, 0.514, 0.5),
    ]


class FindingQuotesTest(unittest.TestCase):
    def test_extracts_quoted_text_from_observation(self):
        quotes = finding_quotes(
            "하단에 '청약 후 15일 이내 청약철회가 가능하며'라는 문구가 보인다.",
            None,
            "청약철회 안내 문구",
        )
        self.assertEqual(quotes, ["청약 후 15일 이내 청약철회가 가능하며"])

    def test_element_aligned_quote_wins_over_the_opposing_action(self):
        """DA-12: observation 에 대립 선택지('가입 완료하기')가 함께 인용돼도 element 와 맞는 문구만 쓴다."""
        quotes = finding_quotes(
            "거절 버튼의 원문은 '혜택을 포기하고 나가기'이고 수락 행동인 '가입 완료하기'가 있다.",
            None,
            "혜택을 포기하고 나가기",
        )
        self.assertEqual(quotes, ["혜택을 포기하고 나가기"])

    def test_falls_back_to_element_when_nothing_is_quoted(self):
        self.assertEqual(finding_quotes("문구가 연하다.", None, "우대금리를 포기할게요"), ["우대금리를 포기할게요"])

    def test_short_quotes_are_ignored(self):
        self.assertEqual(finding_quotes("'동의' 버튼", None, "동의"), [])


class MatchQuoteTest(unittest.TestCase):
    def test_matches_ocr_lines_despite_spacing_and_misreads(self):
        found = match_quote(PARAGRAPH, faint_paragraph(), CFG)
        self.assertIsNotNone(found)
        self.assertEqual(len(found.anchors), 2)
        self.assertGreaterEqual(found.coverage, 0.5)

    def test_unrelated_lines_do_not_match(self):
        anchors = [line("가입 내용을 확인해 주세요", 0.05, 0.17, 0.6), line("상품 든든안심 실손의료비", 0.09, 0.29, 0.6)]
        self.assertIsNone(match_quote(PARAGRAPH, anchors, CFG))

    def test_partial_coverage_below_threshold_fails(self):
        anchors = [line("청약 후 15일 이내", 0.05, 0.5, 0.3)]
        self.assertIsNone(match_quote(PARAGRAPH, anchors, CFG))


class BoxShapeTest(unittest.TestCase):
    def test_union_pads_short_labels_more_than_wide_paragraphs(self):
        label = union_bbox([line("혜택을 포기하고 나가기", 0.1, 0.9, 0.3, 0.018)], 780, 1688, CFG)
        wide = union_bbox([line("가" * 20, 0.05, 0.5, 0.9, 0.018)], 780, 1688, CFG)
        self.assertGreater(label[2], 0.3 + 0.01)   # 가로로 넓어짐
        self.assertAlmostEqual(wide[0], 0.05, delta=0.012)  # 문단은 거의 그대로

    def test_expands_to_following_lines_of_the_same_paragraph_only(self):
        anchors = [
            line("보험료 안내 첫째 줄입니다 문단", 0.05, 0.700, 0.9),
            line("둘째 줄입니다 같은 문단이다", 0.05, 0.716, 0.7),
            line("셋째 줄입니다 같은 문단이다", 0.05, 0.732, 0.6),
            line("멀리 떨어진 다른 문단입니다", 0.05, 0.800, 0.6),          # 간격이 넓다
            line("같은 행의 옆 요소입니다", 0.6, 0.701, 0.3),              # 같은 행(옆)
        ]
        grown = expand_to_paragraph([anchors[0]], anchors, CFG)
        texts = {a.text for a in grown}
        self.assertEqual(
            texts,
            {"보험료 안내 첫째 줄입니다 문단", "둘째 줄입니다 같은 문단이다", "셋째 줄입니다 같은 문단이다"},
        )

    def test_candidates_keep_distant_buttons_apart(self):
        anchors = [
            line("혜택을 포기하고", 0.06, 0.912, 0.24, 0.018),
            line("가입 완료하기", 0.52, 0.915, 0.25, 0.018),
        ]
        candidates = build_text_candidates(anchors, CFG, image_size=(780, 1688))
        self.assertEqual([c.candidate_id for c in candidates], ["T1", "T2"])


class GroundTextFindingTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.image = Path(directory.name) / "screen.png"
        Image.new("RGB", (390, 844), "white").save(self.image)
        self.model_bbox = (0.05, 0.79, 0.87, 0.05)  # 빈 영역을 가리킨 모델 좌표

    def test_quote_match_replaces_the_model_box(self):
        result = ground_text_finding(
            self.image, self.model_bbox, quotes=[PARAGRAPH], evidence_text="청약철회",
            anchors=faint_paragraph(), rule_id="DA-07", config=CFG,
        )
        self.assertEqual(result.method, METHOD_OCR_FUZZY)
        self.assertAlmostEqual(result.bbox[1], 0.497, delta=0.02)
        self.assertGreaterEqual(result.confidence, CFG.apply_confidence)

    def test_paragraph_selection_is_used_when_the_quote_is_not_found(self):
        anchors = [line("가입 내용을 확인해 주세요", 0.05, 0.17, 0.6), line("전혀 다른 문장이 여기 있습니다", 0.05, 0.5, 0.8)]
        asked = {}

        def selector(path, text, candidates):
            asked["ids"] = [item["candidate_id"] for item in candidates]
            asked["kinds"] = {item["kind"] for item in candidates}
            return {"selected_candidate_id": "T2", "semantic_confidence": 0.9}

        result = ground_text_finding(
            self.image, self.model_bbox, quotes=["화면에 없는 문장입니다 정말로"], evidence_text="x",
            anchors=anchors, rule_id="DA-07", selector=selector, config=CFG,
        )
        self.assertEqual(result.method, METHOD_PARAGRAPH_SELECT)
        self.assertEqual(result.candidate_id, "T2")
        self.assertEqual(asked["ids"], ["T1", "T2"])
        self.assertEqual(asked["kinds"], {"text_paragraph"})
        self.assertAlmostEqual(result.bbox[1], 0.5, delta=0.001)

    def test_selector_none_or_error_keeps_the_model_box(self):
        anchors = [line("전혀 다른 문장이 여기 있습니다", 0.05, 0.5, 0.8)]
        for selector in (
            lambda *a: {"selected_candidate_id": "NONE"},
            lambda *a: (_ for _ in ()).throw(RuntimeError("boom")),
        ):
            result = ground_text_finding(
                self.image, self.model_bbox, quotes=["화면에 없는 문장입니다 정말로"], evidence_text="x",
                anchors=anchors, rule_id="DA-07", selector=selector, config=CFG,
            )
            self.assertEqual(result.method, METHOD_MODEL_FALLBACK)
            self.assertEqual(result.bbox, self.model_bbox)
            self.assertFalse(result.usable)

    def test_no_ocr_text_records_the_fallback_reason(self):
        result = ground_text_finding(
            self.image, self.model_bbox, quotes=[PARAGRAPH], evidence_text="x",
            anchors=[], rule_id="DA-07", config=CFG,
        )
        self.assertEqual((result.method, result.warning), (METHOD_MODEL_FALLBACK, "no_ocr_text"))


class _FaintTextOCR:
    """원본 이미지에서는 아무것도 못 읽고, 대비를 키운 2배 이미지에서만 연한 문단을 읽는 OCR."""

    def extract(self, image_path):
        with Image.open(image_path) as image:
            width, height = image.size
        if width < 700:
            return OCRResult()
        return OCRResult([OCRTextBlock(
            "청약 후 15일 이내 청약철회가 가능하며", (round(0.049 * width), round(0.497 * height), round(0.9 * width), round(0.014 * height)), 0.9,
        )])


class EnhancedOcrTest(unittest.TestCase):
    def test_enhanced_pass_adds_lines_the_plain_pass_missed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "screen.png"
            Image.new("RGB", (390, 844), "white").save(path)
            plain = extract_text_anchors(path, NullOCR(), base=[])
            enhanced = extract_text_anchors(path, _FaintTextOCR(), base=[])
        self.assertEqual(plain, [])
        self.assertEqual(len(enhanced), 1)
        self.assertAlmostEqual(enhanced[0].bbox[1], 0.497, delta=0.01)


class BaselineTextGroundingTest(unittest.TestCase):
    def _finding(self, rule_id="DA-07", risk=RiskType.HIDDEN_INFORMATION):
        return Detection(
            risk_type=risk, risk_name=RISK_NAME_MAP[risk],
            where=DetectionLocation(("screen-01",), "청약철회 안내 문구", "하단 안내"),
            bbox=(0.05, 0.79, 0.87, 0.05), related_elements=(),
            what="청약철회 가능 기간 문구가 연하다", observation=f"'{PARAGRAPH}' 문구가 연한 색이다.",
            rule_id=rule_id, why="중요 권리 정보가 숨겨진다", severity=Severity.HIGH,
            confidence=0.9, fix="대비를 높인다",
        )

    def test_da07_box_and_grounding_method_are_recorded_in_telemetry(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "01.png"
            Image.new("RGB", (390, 844), "white").save(path)
            screen = AuditScreen(
                "screen-01", "화면 1", path, "unspecified", "main", "1",
                tuple({"text": a.text, "bbox": list(a.bbox), "confidence": a.confidence} for a in faint_paragraph()),
            )
            request = LLMAuditRequest("audit", (screen,))
            pipeline = BaselineAuditPipeline(FakeMultimodalProvider(), ocr_provider=NullOCR())
            finding = self._finding()
            output = HybridAuditOutput(
                "audit", request.schema_version, (ScreenReference("screen-01", "화면 1"),),
                (), (finding,), (), frozenset({"DA-07"}),
            )
            grounded, telemetry = pipeline._ground_visual_bboxes(output, request)

        updated = grounded.semantic_findings[0]
        self.assertNotEqual(updated.bbox, finding.bbox)
        self.assertAlmostEqual(updated.bbox[1], 0.497, delta=0.02)
        self.assertEqual(telemetry[0]["grounding_method"], METHOD_OCR_FUZZY)
        self.assertTrue(telemetry[0]["applied"])

    def test_failure_keeps_the_model_box_and_records_the_method(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "01.png"
            Image.new("RGB", (390, 844), "white").save(path)
            screen = AuditScreen("screen-01", "화면 1", path, "unspecified", "main", "1", ())
            request = LLMAuditRequest("audit", (screen,))
            pipeline = BaselineAuditPipeline(FakeMultimodalProvider(), ocr_provider=NullOCR())
            finding = self._finding()
            output = HybridAuditOutput(
                "audit", request.schema_version, (ScreenReference("screen-01", "화면 1"),),
                (), (finding,), (), frozenset({"DA-07"}),
            )
            grounded, telemetry = pipeline._ground_visual_bboxes(output, request)

        self.assertEqual(grounded.semantic_findings[0].bbox, finding.bbox)
        self.assertEqual(telemetry[0]["grounding_method"], METHOD_MODEL_FALLBACK)
        self.assertFalse(telemetry[0]["applied"])


if __name__ == "__main__":
    unittest.main()
