"""DA-03 대립 선택지 쌍 탐지: 나란한 배치와 위아래로 쌓인 모바일 배치."""

import unittest

from backend.app.rule_engine import checks  # noqa: F401 — 체크 등록
from backend.app.rule_engine.core import Element, Flow, RuleBase, Screen, run


def _button(element_id, text, bbox, font_size, contrast):
    return Element(
        element_id, "button", text, bbox, {},
        {"font_size": font_size, "contrast_ratio": contrast,
         "area_ratio": bbox[2] * bbox[3]},
    )


def _da03(buttons):
    flow = Flow("f", "join", None, [Screen(1, buttons, "1")])
    return [d for d in run(flow, RuleBase(), only={"DA-03"}) if d.rule_id == "DA-03"]


ACCEPT = _button("accept", "다음 · 혜택 알림 받기 →", [0.06, 0.843, 0.88, 0.061], 13, 5.4)


class StackedPairTest(unittest.TestCase):
    def test_side_by_side_still_detected(self):
        decline = _button("decline", "가입하지 않기", [0.05, 0.89, 0.27, 0.078], 9, 1.9)
        accept = _button("accept", "가입 완료하기", [0.34, 0.89, 0.61, 0.078], 16, 6.6)
        self.assertTrue(_da03([accept, decline]))

    def test_stacked_small_decline_with_hint_is_detected(self):
        decline = _button("decline", "수신 거절 유지하고 계속", [0.06, 0.912, 0.88, 0.034], 9, 1.95)
        detections = _da03([ACCEPT, decline])
        self.assertTrue(detections)
        self.assertEqual({d.primary.element_id for d in detections}, {"accept"})

    def test_stacked_without_decline_hint_is_not_detected(self):
        decline = _button("decline", "알림 없이 계속", [0.06, 0.912, 0.88, 0.034], 9, 1.95)
        self.assertFalse(_da03([ACCEPT, decline]))

    def test_stacked_but_decline_not_smaller_is_not_detected(self):
        decline = _button("decline", "수신 거절 유지하고 계속", [0.06, 0.912, 0.88, 0.07], 13, 5.4)
        self.assertFalse(_da03([ACCEPT, decline]))

    def test_stacked_within_gap_tolerance_is_detected(self):
        decline = _button("decline", "수신 거절 유지하고 계속", [0.06, 0.95, 0.88, 0.03], 9, 1.95)
        self.assertTrue(_da03([ACCEPT, decline]))  # 간격 0.046 ≤ 0.05

    def test_stacked_with_large_gap_is_not_detected(self):
        far = _button("decline", "수신 거절 유지하고 계속", [0.06, 0.98, 0.88, 0.015], 9, 1.95)
        self.assertFalse(_da03([ACCEPT, far]))  # 간격 0.076 > 0.05

    def test_stacked_without_horizontal_overlap_is_not_detected(self):
        decline = _button("decline", "수신 거절 유지하고 계속", [0.0, 0.912, 0.3, 0.034], 9, 1.95)
        narrow = _button("accept", "계속", [0.6, 0.843, 0.3, 0.061], 13, 5.4)
        self.assertFalse(_da03([narrow, decline]))


if __name__ == "__main__":
    unittest.main()
