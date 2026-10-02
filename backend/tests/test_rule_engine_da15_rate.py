"""DA-15 이율 후보: 초기 화면이 단일 수치인지 범위인지를 measurements 로 넘긴다."""

import unittest

from backend.app.rule_engine import checks  # noqa: F401 — 체크 등록
from backend.app.rule_engine.core import Element, Flow, RuleBase, Screen, run
from backend.app.rule_engine.severity import drop_incomplete, merge, score


def _price(element_id, text):
    return Element(element_id, "price", text, [0.1, 0.3, 0.8, 0.05], {}, {"font_size": 26})


def _flow(first_text, final_text="연 2.5%", extra_first=()):
    screens = [
        Screen(1, [_price("p-first", first_text), *extra_first], "1"),
        Screen(2, [], "2"),
        Screen(3, [], "3"),
        Screen(4, [_price("p-final", final_text)], "4"),
    ]
    return Flow("f", "join", "deposit", screens)


def _candidate(flow):
    rb = RuleBase()
    findings = score(drop_incomplete(merge(run(flow, rb, only={"DA-15"}), rb), rb), rb)
    return next(f for f in findings if f.rule_id == "DA-15")


class InitialRateDisplayTest(unittest.TestCase):
    def test_single_point_first_screen_is_passed_to_candidate(self):
        candidate = _candidate(_flow("연 4.5%"))
        self.assertEqual(candidate.measurements["initial_rate_display"], "single_point")
        self.assertEqual(candidate.measurements["initial_rate_text"], "연 4.5%")
        self.assertEqual(candidate.measurements["initial_rate_screen_index"], 1)
        # 이전부터 넘기던 값은 그대로다.
        self.assertEqual(candidate.measurements["displayed"], "연 4.5%")
        self.assertEqual(candidate.measurements["initial_rate"], 4.5)
        self.assertIn("single_point_rate_display", candidate.triggered_checks)

    def test_range_first_screen_is_marked_as_range(self):
        candidate = _candidate(_flow("연 2.0~4.5%", final_text="연 2.0%"))
        self.assertEqual(candidate.measurements["initial_rate_display"], "range")
        self.assertEqual(candidate.measurements["initial_rate_text"], "연 2.0~4.5%")
        # 범위 표시는 단일 이율 체크의 대상이 아니다(원문이 인정한 완화).
        self.assertNotIn("single_point_rate_display", candidate.triggered_checks)
        self.assertNotIn("displayed", candidate.measurements)

    def test_initial_screen_is_the_first_screen_that_shows_a_rate(self):
        """이율이 둘째 화면에서 처음 나오면 그 화면이 초기 화면이다."""
        flow = Flow("f", "join", "deposit", [
            Screen(1, [], "1"),
            Screen(2, [_price("p-first", "연 4.5%")], "2"),
            Screen(3, [_price("p-final", "연 2.5%")], "3"),
        ])
        candidate = _candidate(flow)
        self.assertEqual(candidate.measurements["initial_rate_screen_index"], 2)
        self.assertEqual(candidate.measurements["initial_rate_display"], "single_point")
        # 첫 화면(1번)에는 이율이 없으므로 single_point_rate_display 체크는 걸리지 않는다.
        self.assertNotIn("single_point_rate_display", candidate.triggered_checks)

    def test_price_amount_candidates_do_not_get_rate_fields(self):
        flow = Flow("f", "join", "insurance", [
            Screen(1, [_price("a", "월 9,900원")], "1"),
            Screen(2, [], "2"),
            Screen(3, [_price("b", "월 15,900원")], "3"),
        ])
        candidate = _candidate(flow)
        self.assertNotIn("initial_rate_display", candidate.measurements)


if __name__ == "__main__":
    unittest.main()
