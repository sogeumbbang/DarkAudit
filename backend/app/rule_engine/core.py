"""
Rule Engine 코어
---------------
Rule Base 의 deterministic_checks 를 실제로 실행한다.

규칙 데이터와 코드를 잇는 방식

    Rule Base 의 check 는 "area_ratio >= 1.5" 같은 **설명 문자열**이며 실행 가능한
    코드가 아니다. 이를 잇는 두 가지 방법이 있다.

      (A) YAML 에 표현식을 넣고 eval    데이터만 고쳐 규칙 변경 가능하나
                                        복잡한 로직을 표현할 수 없고 디버깅이 어렵다
      (B) check_id → 함수 매핑          코드가 필요하나 명확하고 테스트 가능하다

    (B) 를 택했다. 우리 체크에는 "대립하는 선택지 쌍을 찾아 비교" 처럼 표현식으로
    쓸 수 없는 것이 포함된다. 임계값만 YAML 에서 읽어 코드와 데이터의 역할을 나눈다.

    다만 YAML 에 있는 check 가 구현되지 않은 채 남으면 조용히 탐지가 누락된다.
    audit_coverage() 로 미구현 목록을 드러낸다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import yaml

RULES_PATH = Path(__file__).resolve().parents[3] / "rules" / "dark_pattern_rules.yaml"


# ---------------------------------------------------------------- 입력 자료구조


@dataclass
class Element:
    element_id: str
    element_type: str
    text: str | None
    bbox: list[float]
    state: dict
    style: dict

    @property
    def area(self) -> float:
        return self.style.get("area_ratio", 0.0)

    @property
    def font_size(self) -> float:
        return self.style.get("font_size") or 0.0

    @property
    def contrast(self) -> float | None:
        return self.style.get("contrast_ratio")

    @property
    def checked(self) -> bool:
        return bool(self.state.get("checked"))

    @property
    def center(self) -> tuple[float, float]:
        x, y, w, h = self.bbox
        return (x + w / 2, y + h / 2)


@dataclass
class Screen:
    screen_index: int
    elements: list[Element]
    state_id: str = ""

    def of_type(self, *types: str) -> list[Element]:
        return [e for e in self.elements if e.element_type in types]


@dataclass
class Flow:
    flow_id: str
    flow_type: str
    sector: str | None
    screens: list[Screen]


# ---------------------------------------------------------------- 탐지 결과


@dataclass
class Detection:
    """deterministic check 하나가 만들어낸 위험 후보."""
    rule_id: str
    check_id: str
    screen_index: int | None = None
    primary: Element | None = None
    related: list[Element] = field(default_factory=list)
    measurements: dict = field(default_factory=dict)
    screen_indices: list[int] = field(default_factory=list)

    @property
    def key(self) -> tuple:
        """같은 규칙·같은 요소에 여러 check 가 걸릴 때 합치기 위한 키."""
        pid = self.primary.element_id if self.primary else None
        return (self.rule_id, self.screen_index, pid)


# ---------------------------------------------------------------- 레지스트리

# check_id → 실행 함수
_SCREEN_CHECKS: dict[str, Callable] = {}
_FLOW_CHECKS: dict[str, Callable] = {}


def screen_check(rule_id: str, check_id: str):
    """화면 한 장으로 판정 가능한 체크를 등록한다."""
    def deco(fn):
        _SCREEN_CHECKS[f"{rule_id}.{check_id}"] = (rule_id, check_id, fn)
        return fn
    return deco


def flow_check(rule_id: str, check_id: str):
    """화면 시퀀스를 봐야 하는 체크를 등록한다."""
    def deco(fn):
        _FLOW_CHECKS[f"{rule_id}.{check_id}"] = (rule_id, check_id, fn)
        return fn
    return deco


# ---------------------------------------------------------------- Rule Base


class RuleBase:
    def __init__(self, path: Path = RULES_PATH):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        self.meta = doc["meta"]
        self.rules = {r["rule_id"]: r for r in doc["rules"]}

    def get(self, rule_id: str) -> dict:
        return self.rules[rule_id]

    def threshold(self, rule_id: str, check_id: str, default=None):
        """YAML 에 적힌 임계값을 읽는다. 코드에 숫자를 박지 않기 위함."""
        for c in self.rules[rule_id]["deterministic_checks"]:
            if c["id"] == check_id:
                raw = c.get("threshold")
                if raw is None:
                    return default
                m = re.search(r"-?\d+\.?\d*", str(raw))
                return float(m.group()) if m else default
        return default

    def declared_checks(self) -> set[str]:
        return {
            f"{rid}.{c['id']}"
            for rid, r in self.rules.items()
            for c in r["deterministic_checks"]
        }


def audit_coverage(rb: RuleBase) -> dict:
    """
    YAML 에 선언된 check 와 실제 구현된 check 를 대조한다.

    미구현 check 는 조용히 탐지 누락으로 이어지므로 명시적으로 드러낸다.
    """
    declared = rb.declared_checks()
    implemented = set(_SCREEN_CHECKS) | set(_FLOW_CHECKS)
    return {
        "declared": len(declared),
        "implemented": len(implemented & declared),
        "missing": sorted(declared - implemented),
        "orphan": sorted(implemented - declared),   # YAML 에 없는 구현
    }


# ---------------------------------------------------------------- 실행


def run(flow: Flow, rb: RuleBase, only: set[str] | None = None) -> list[Detection]:
    """Flow 하나에 대해 등록된 모든 체크를 실행한다."""
    out: list[Detection] = []

    for key, (rule_id, check_id, fn) in _SCREEN_CHECKS.items():
        if only and rule_id not in only:
            continue
        for sc in flow.screens:
            for det in fn(sc, rb) or []:
                det.rule_id, det.check_id = rule_id, check_id
                det.screen_index = sc.screen_index
                out.append(det)

    for key, (rule_id, check_id, fn) in _FLOW_CHECKS.items():
        if only and rule_id not in only:
            continue
        for det in fn(flow, rb) or []:
            det.rule_id, det.check_id = rule_id, check_id
            out.append(det)

    return out


def load_flow(doc: dict) -> Flow:
    """extract_ui.py 가 만든 JSON 을 Flow 로 변환한다."""
    screens = []
    for s in doc["screens"]:
        els = [
            Element(
                element_id=e["element_id"],
                element_type=e["element_type"],
                text=e.get("text"),
                bbox=e["bbox"],
                state=e.get("state") or {},
                style=e.get("computed_style") or {},
            )
            for e in s["elements"]
        ]
        screens.append(Screen(s["screen_index"], els))
    return Flow(doc["flow_id"], doc.get("flow_type", "join"), doc.get("sector"), screens)
