"""
Deterministic Check 구현
-----------------------
Rule Base 에 선언된 check 를 실제로 계산한다. MVP P0 유형 우선.

여기서 하는 것은 **관찰 가능한 사실의 계산**뿐이다.
"이 옵션이 선택적 유료 부가서비스인가", "이 표현이 압박인가" 같은 의미 판단은
Multimodal LLM 의 semantic_checks 몫이며 여기서 다루지 않는다.

임계값은 코드에 박지 않고 Rule Base 에서 읽는다. 값을 조정할 때 YAML 한 곳만
고치면 되고, 문서와 구현이 어긋나지 않는다.
"""

from __future__ import annotations

import re

from .core import Detection, Element, Flow, RuleBase, Screen, flow_check, screen_check

# 금액·이율 패턴
_MONEY = re.compile(r"([\d,]+)\s*원")
_RATE = re.compile(r"([\d.]+)\s*%")

# 감정 자극 어휘. 원문 예시(부담스러우세요/체험)와 손실 프레이밍 표현.
_EMOTIVE = [
    "포기", "손해", "후회", "놓치", "부담스러", "정말 괜찮", "아쉽",
    "마지막 기회", "다시 없", "혜택을 버리",
]
_TRIVIALIZE = ["체험", "가볍게", "부담없이", "잠깐"]

# 거절 의도를 나타내는 라벨 (대립 쌍 판별용)
_DECLINE_HINT = ["않기", "안함", "취소", "나가기", "다음에", "거절", "포기", "닫기"]


def _pair_of_options(screen: Screen) -> tuple[Element, Element] | None:
    """
    같은 화면에서 대립하는 선택지 쌍(수락 / 거절)을 찾는다.

    표현식으로는 쓸 수 없고 코드가 필요한 대표적인 체크다.
    나란히 배치된 버튼 두 개 중 한쪽 라벨이 거절 의미면 쌍으로 본다.
    """
    buttons = [e for e in screen.of_type("button") if e.text]
    if len(buttons) < 2:
        return None

    for a in buttons:
        for b in buttons:
            if a is b:
                continue
            # 세로 위치가 비슷해야 나란한 선택지다
            if abs(a.center[1] - b.center[1]) > 0.05:
                continue
            if any(h in (b.text or "") for h in _DECLINE_HINT):
                return a, b        # a = 수락, b = 거절
    return None


# ---------------------------------------------------------------- DA-03


@screen_check("DA-03", "area_ratio")
def da03_area(screen: Screen, rb: RuleBase) -> list[Detection]:
    pair = _pair_of_options(screen)
    if not pair:
        return []
    accept, decline = pair
    if decline.area <= 0:
        return []
    ratio = accept.area / decline.area
    th = rb.threshold("DA-03", "area_ratio", 1.5)
    if ratio < th:
        return []
    return [Detection("", "", primary=accept, related=[decline],
                      measurements={"area_ratio": round(ratio, 2), "threshold": th})]


@screen_check("DA-03", "font_size_ratio")
def da03_font(screen: Screen, rb: RuleBase) -> list[Detection]:
    pair = _pair_of_options(screen)
    if not pair:
        return []
    accept, decline = pair
    if not decline.font_size:
        return []
    ratio = accept.font_size / decline.font_size
    th = rb.threshold("DA-03", "font_size_ratio", 1.3)
    if ratio < th:
        return []
    return [Detection("", "", primary=accept, related=[decline],
                      measurements={"font_size_ratio": round(ratio, 2), "threshold": th})]


@screen_check("DA-03", "color_prominence_gap")
def da03_color(screen: Screen, rb: RuleBase) -> list[Detection]:
    """한쪽은 짙게, 반대쪽은 배경과 유사하게 처리된 경우 (원문 예시)."""
    pair = _pair_of_options(screen)
    if not pair:
        return []
    accept, decline = pair
    ac, dc = accept.contrast, decline.contrast
    if ac is None or dc is None:
        return []
    # 수락은 충분한 대비, 거절은 배경에 묻히는 수준
    if ac >= 4.5 and dc < 3.0:
        return [Detection("", "", primary=accept, related=[decline],
                          measurements={"accept_contrast": ac, "decline_contrast": dc})]
    return []


# ---------------------------------------------------------------- DA-04


@screen_check("DA-04", "default_checked")
def da04_checked(screen: Screen, rb: RuleBase) -> list[Detection]:
    out = []
    for box in screen.of_type("checkbox"):
        if not box.checked:
            continue
        # 인접 텍스트에서 옵션 설명과 가격을 찾는다
        near = _nearest_text(screen, box)
        price = _MONEY.search(near or "")
        out.append(Detection(
            "", "", primary=box,
            measurements={
                "context": (near or "")[:60],
                "has_additional_cost": bool(price),
            },
        ))
    return out


def _nearest_text(screen: Screen, el: Element) -> str | None:
    """요소를 포함하는 가장 작은 컨테이너의 텍스트를 찾는다."""
    x, y, w, h = el.bbox
    best, best_area = None, 1e9
    for c in screen.elements:
        if c is el or not c.text:
            continue
        cx, cy, cw, ch = c.bbox
        if cx <= x and cy <= y and cx + cw >= x + w and cy + ch >= y + h:
            a = cw * ch
            if a < best_area:
                best, best_area = c, a
    return best.text if best else None


# ---------------------------------------------------------------- DA-07


@screen_check("DA-07", "benefit_risk_asymmetry")
def da07_asymmetry(screen: Screen, rb: RuleBase) -> list[Detection]:
    """
    본문 대비 현저히 작거나 흐린 텍스트를 찾는다.
    중요정보 해당 여부는 semantic_checks 가 판단한다.
    """
    texts = [e for e in screen.of_type("text") if e.text and len(e.text) > 20]
    if not texts:
        return []

    sizes = sorted(e.font_size for e in texts if e.font_size)
    if not sizes:
        return []
    body = sizes[len(sizes) // 2]          # 중앙값을 본문 크기로 본다

    size_th = rb.threshold("DA-07", "benefit_risk_asymmetry", 0.7)
    out = []
    for e in texts:
        ratio = e.font_size / body if body else 1.0
        low_contrast = e.contrast is not None and e.contrast < 4.5
        if ratio <= size_th or low_contrast:
            out.append(Detection(
                "", "", primary=e,
                measurements={
                    "font_size_ratio": round(ratio, 2),
                    "contrast_ratio": e.contrast,
                    "body_font_size": body,
                },
            ))
    return out


@screen_check("DA-07", "detail_behind_click")
def da07_accordion(screen: Screen, rb: RuleBase) -> list[Detection]:
    """중요 정보가 '자세히 보기' 뒤에 접혀 있는 경우."""
    return [
        Detection("", "", primary=e, measurements={"label": e.text})
        for e in screen.of_type("accordion")
    ]


# ---------------------------------------------------------------- DA-12


@screen_check("DA-12", "emotive_lexicon_hit")
def da12_emotive(screen: Screen, rb: RuleBase) -> list[Detection]:
    out = []
    for e in screen.elements:
        if not e.text:
            continue
        hits = [w for w in _EMOTIVE if w in e.text]
        triv = [w for w in _TRIVIALIZE if w in e.text]
        if not hits and not triv:
            continue
        # 버튼·링크에 걸린 경우가 손실 프레이밍일 가능성이 높다
        if e.element_type not in ("button", "link", "text"):
            continue
        out.append(Detection(
            "", "", primary=e,
            measurements={"matched": hits + triv, "text": e.text[:40]},
        ))
    return out


# ---------------------------------------------------------------- DA-13


@screen_check("DA-13", "motion_emphasis")
def da13_motion(screen: Screen, rb: RuleBase) -> list[Detection]:
    """
    점멸·애니메이션이 적용된 요소.
    합의에 따라 MVP 는 감각조작을 동적 효과로 한정한다(정적 강조는 DA-03).
    """
    return [
        Detection("", "", primary=e,
                  measurements={"animated": True, "text": (e.text or "")[:40]})
        for e in screen.elements
        if e.style.get("animated")
    ]


# ---------------------------------------------------------------- DA-15


def _amount_elements(screen: Screen) -> list[tuple[Element, float]]:
    values = []
    for e in screen.of_type("price"):
        if not e.text:
            continue
        for m in _MONEY.finditer(e.text):
            values.append((e, float(m.group(1).replace(",", ""))))
        for m in _RATE.finditer(e.text):
            values.append((e, float(m.group(1))))
    return values


@flow_check("DA-15", "price_increase_across_screens")
def da15_price(flow: Flow, rb: RuleBase) -> list[Detection]:
    """최초 표시 금액 대비 최종 금액이 증가한 경우."""
    series = [(s.screen_index, _amount_elements(s)) for s in flow.screens]
    series = [(i, v) for i, v in series if v]
    if len(series) < 2:
        return []

    first_idx, first = series[0]
    last_idx, last = series[-1]
    first_element, first_amount = max(first, key=lambda item: item[1])
    last_element, last_amount = max(last, key=lambda item: item[1])
    # 금액(원)만 대상. 이율은 아래 별도 체크에서 다룬다.
    if first_amount < 100 or last_amount < 100:
        return []
    if last_amount <= first_amount:
        return []

    return [Detection(
        "", "", primary=last_element, related=[first_element],
        screen_indices=[first_idx, last_idx],
        measurements={"initial": first_amount, "final": last_amount,
                      "delta": last_amount - first_amount},
    )]


@flow_check("DA-15", "rate_deterioration_across_screens")
def da15_rate(flow: Flow, rb: RuleBase) -> list[Detection]:
    """
    최초 표시 이율 대비 최종 적용 이율이 소비자에게 불리하게 변경된 경우.
    예적금 Flow 를 위해 필요하다. 보험(금액 상승)과 방향이 반대다.
    """
    series = [
        (s.screen_index, [(element, value) for element, value in _amount_elements(s) if value < 100])
        for s in flow.screens
    ]
    series = [(i, v) for i, v in series if v]
    if len(series) < 2:
        return []

    first_idx, first = series[0]
    last_idx, last = series[-1]
    first_element, first_rate = max(first, key=lambda item: item[1])
    last_element, last_rate = max(last, key=lambda item: item[1])
    if last_rate >= first_rate:
        return []

    return [Detection(
        "", "", primary=last_element, related=[first_element],
        screen_indices=[first_idx, last_idx],
        measurements={"initial_rate": first_rate, "final_rate": last_rate,
                      "drop": round(first_rate - last_rate, 2)},
    )]


@flow_check("DA-15", "single_point_rate_display")
def da15_single_rate(flow: Flow, rb: RuleBase) -> list[Detection]:
    """
    첫 화면에 단일 최고 이율만 표시하고 범위를 제시하지 않은 경우.
    범위 표시(2.0~4.5%)는 원문이 인정한 완화 수단이므로 탐지에서 제외한다.
    """
    if not flow.screens:
        return []
    first = flow.screens[0]
    for e in first.of_type("price"):
        if not e.text or "%" not in e.text:
            continue
        if "~" in e.text or "-" in e.text:
            return []                      # 범위로 표시됨 → 해당 없음
        return [Detection("", "", primary=e, screen_indices=[first.screen_index],
                          measurements={"displayed": e.text})]
    return []
