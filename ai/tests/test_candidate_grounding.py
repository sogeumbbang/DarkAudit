import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai.vision.candidate_grounding import (
    generate_control_candidates,
    ground_selected_control_bbox,
)
from ai.vision.ocr import TesseractOCR


SAMPLE = Path(__file__).resolve().parents[2] / "frontend/public/sample-audit/02-preselected-addon.png"


class TesseractOCRTests(unittest.TestCase):
    def test_extract_returns_line_level_text_and_pixel_bbox(self) -> None:
        payload = (
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
            "5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90\t안심케어\n"
            "5\t1\t1\t1\t1\t2\t45\t20\t20\t12\t80\t플러스\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "screen.png"
            Image.new("RGB", (100, 80), "white").save(image_path)
            completed = subprocess.CompletedProcess([], 0, payload, "")
            with patch("ai.vision.ocr.subprocess.run", return_value=completed):
                result = TesseractOCR().extract(image_path)

        self.assertEqual(result.text, "안심케어 플러스")
        self.assertEqual(result.blocks[0].bbox, (10, 20, 55, 12))
        self.assertAlmostEqual(result.blocks[0].confidence, 0.85)


class CandidateGroundingTests(unittest.TestCase):
    def test_coarse_option_card_keeps_compact_control_in_top_candidates(self) -> None:
        with Image.open(SAMPLE) as image:
            candidates, _ = generate_control_candidates(
                image,
                (0.06, 0.29, 0.88, 0.27),
                limit=12,
            )

        left, top, width, height = candidates[0].bbox
        self.assertAlmostEqual(left, 44 / 390, delta=0.01)
        self.assertAlmostEqual(top, 292 / 844, delta=0.01)
        self.assertAlmostEqual(width, 28 / 390, delta=0.01)
        self.assertAlmostEqual(height, 28 / 844, delta=0.01)
        self.assertGreaterEqual(len(candidates[0].sources), 2)

    def test_set_of_mark_selection_uses_candidate_bbox_and_hides_coordinates(self) -> None:
        seen_payload = []

        def selector(_path, _text, candidates):
            seen_payload.extend(candidates)
            return {
                "rule_id": "DA-04",
                "selected_candidate_id": "C1",
                "semantic_confidence": 0.93,
            }

        approximate = (0.06, 0.29, 0.88, 0.27)
        result = ground_selected_control_bbox(
            SAMPLE,
            approximate,
            "안심케어 플러스",
            selector=selector,
            ocr_anchors=[],
        )

        self.assertEqual(result.candidate_id, "C1")
        self.assertEqual(result.source, "set-of-mark+cv")
        self.assertEqual(result.confidence, 0.93)
        self.assertNotEqual(result.bbox, approximate)
        self.assertTrue(all("bbox" not in candidate for candidate in seen_payload))

    def test_set_of_mark_none_preserves_model_evidence_box(self) -> None:
        approximate = (0.06, 0.29, 0.88, 0.27)
        result = ground_selected_control_bbox(
            SAMPLE,
            approximate,
            "안심케어 플러스",
            selector=lambda *_: {
                "rule_id": "DA-04",
                "selected_candidate_id": "NONE",
                "semantic_confidence": 0.9,
            },
            ocr_anchors=[],
        )

        self.assertEqual(result.bbox, approximate)
        self.assertEqual(result.source, "set-of-mark-rejected")
        self.assertEqual(result.confidence, 0.0)


if __name__ == "__main__":
    unittest.main()
