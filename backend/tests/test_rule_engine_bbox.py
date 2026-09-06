import unittest

from backend.app.rule_engine.checks import da15_price, da15_rate
from backend.app.rule_engine.core import Element, Flow, RuleBase, Screen, run
from backend.app.rule_engine.severity import merge


def price_element(element_id: str, text: str, bbox: list[float]) -> Element:
    return Element(element_id, "price", text, bbox, {}, {})


class RuleEngineBBoxTest(unittest.TestCase):
    def test_amount_units_are_not_inferred_from_numeric_magnitude(self):
        initial = price_element("first", "비용 50원 이율 4.5%", [0.1, 0.3, 0.4, 0.06])
        final = price_element("last", "비용 60원 이율 3.0%", [0.1, 0.3, 0.4, 0.06])
        flow = Flow("flow", "join", None, [Screen(1, [initial]), Screen(2, [final])])
        self.assertEqual(da15_price(flow, RuleBase())[0].measurements["initial"], 50)
        self.assertEqual(da15_rate(flow, RuleBase())[0].measurements["initial_rate"], 4.5)

    def test_da15_price_anchors_primary_and_related_price_elements(self) -> None:
        initial = price_element("initial-price", "1,000원", [0.1, 0.3, 0.4, 0.06])
        final = price_element("final-price", "1,500원", [0.2, 0.7, 0.5, 0.08])
        flow = Flow("flow-1", "join", None, [Screen(1, [initial]), Screen(2, [final])])

        detection = da15_price(flow, RuleBase())[0]

        assert detection.primary is final
        assert detection.related == [initial]
        assert detection.screen_indices == [1, 2]


    def test_da15_rate_anchors_primary_and_related_rate_elements(self) -> None:
        initial = price_element("initial-rate", "4.5%", [0.1, 0.3, 0.4, 0.06])
        final = price_element("final-rate", "3.0%", [0.2, 0.7, 0.5, 0.08])
        flow = Flow("flow-1", "join", None, [Screen(1, [initial]), Screen(2, [final])])

        detection = da15_rate(flow, RuleBase())[0]

        assert detection.primary is final
        assert detection.related == [initial]
        assert detection.screen_indices == [1, 2]


    def test_da15_evidence_anchors_do_not_split_one_flow_finding(self) -> None:
        first_price = price_element("initial-price", "1,000원", [0.1, 0.2, 0.4, 0.06])
        first_rate = price_element("initial-rate", "4.5%", [0.1, 0.3, 0.4, 0.06])
        final_price = price_element("final-price", "1,500원", [0.2, 0.6, 0.5, 0.08])
        final_rate = price_element("final-rate", "3.0%", [0.2, 0.7, 0.5, 0.08])
        flow = Flow(
            "flow-1",
            "join",
            None,
            [Screen(1, [first_price, first_rate]), Screen(2, [final_price, final_rate])],
        )
        rule_base = RuleBase()

        findings = merge(run(flow, rule_base, only={"DA-15"}), rule_base)

        assert len(findings) == 1
        assert set(findings[0].related_ids) == {"initial-price", "initial-rate"}
