import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api.store import _primary_bbox
from backend.app.models import Element, Finding, Screen


class PrimaryBBoxTests(unittest.TestCase):
    def setUp(self) -> None:
        self.screen = Screen(
            id=7,
            run_id=1,
            screen_index=2,
            image_path="/artifacts/uploads/audit-1/run-1/02.png",
        )
        self.element = Element(
            id=8,
            screen_id=7,
            element_type="vision",
            text="선택 상태",
            bbox_x=0.08,
            bbox_y=0.36,
            bbox_w=0.08,
            bbox_h=0.06,
            source="vision",
        )
        self.finding = Finding(rule_id="DA-04")
        self.finding.primary_element = self.element

    @patch("backend.api.store.refine_selected_control_bbox")
    def test_visual_da04_uses_refined_normalized_box(self, refine) -> None:
        refine.return_value = (0.11, 0.34, 0.08, 0.04)

        result = _primary_bbox(self.finding, "screen-02", {7: self.screen})

        self.assertIsNotNone(result)
        self.assertEqual((result.x, result.y, result.width, result.height), refine.return_value)
        refine.assert_called_once_with(
            str(Path("data/uploads/audit-1/run-1/02.png").resolve()),
            (0.08, 0.36, 0.08, 0.06),
        )

    @patch("backend.api.store.refine_selected_control_bbox")
    def test_dom_da04_keeps_browser_box(self, refine) -> None:
        self.element.source = "dom"

        result = _primary_bbox(self.finding, "screen-02", {7: self.screen})

        self.assertIsNotNone(result)
        self.assertEqual((result.x, result.y, result.width, result.height), (0.08, 0.36, 0.08, 0.06))
        refine.assert_not_called()

    @patch("backend.api.store.refine_selected_control_bbox")
    def test_candidate_grounded_da04_is_not_refined_twice(self, refine) -> None:
        self.element.source = "vision-grounded"

        result = _primary_bbox(self.finding, "screen-02", {7: self.screen})

        self.assertIsNotNone(result)
        self.assertEqual(
            (result.x, result.y, result.width, result.height),
            (0.08, 0.36, 0.08, 0.06),
        )
        refine.assert_not_called()

    @patch("backend.api.store.refine_prominent_cta_bbox")
    def test_legacy_visual_da03_uses_cta_refinement(self, refine) -> None:
        self.finding.rule_id = "DA-03"
        refine.return_value = (0.061538, 0.815166, 0.876923, 0.075829)

        result = _primary_bbox(self.finding, "screen-02", {7: self.screen})

        self.assertIsNotNone(result)
        self.assertEqual((result.x, result.y, result.width, result.height), refine.return_value)
        refine.assert_called_once()


if __name__ == "__main__":
    unittest.main()
