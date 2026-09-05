import unittest
from pathlib import Path

from ai.vision.bbox_refinement import refine_selected_control_bbox


SAMPLE = Path(__file__).resolve().parents[2] / "frontend/public/sample-audit/02-preselected-addon.png"


class BBoxRefinementTests(unittest.TestCase):
    def test_da04_vision_box_snaps_to_checked_control(self) -> None:
        refined = refine_selected_control_bbox(str(SAMPLE), (0.08, 0.36, 0.08, 0.06))

        left, top, width, height = refined
        self.assertAlmostEqual(left, 42 / 390, delta=0.01)
        self.assertAlmostEqual(top, 290 / 844, delta=0.01)
        self.assertAlmostEqual(width, 31 / 390, delta=0.01)
        self.assertAlmostEqual(height, 31 / 844, delta=0.01)

    def test_coarse_option_card_box_still_snaps_to_checked_control(self) -> None:
        refined = refine_selected_control_bbox(str(SAMPLE), (0.06, 0.29, 0.88, 0.27))

        left, top, width, height = refined
        self.assertAlmostEqual(left, 42 / 390, delta=0.01)
        self.assertAlmostEqual(top, 290 / 844, delta=0.01)
        self.assertLess(width, 0.1)
        self.assertLess(height, 0.05)

    def test_missing_image_keeps_original_box(self) -> None:
        original = (0.08, 0.36, 0.08, 0.06)
        self.assertEqual(refine_selected_control_bbox("missing.png", original), original)


if __name__ == "__main__":
    unittest.main()
