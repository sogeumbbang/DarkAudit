"""Figma 파일 트리에서 분석 대상 프레임을 고른다 (docs/figma_fastapi_handoff.md 6절).

get_file() 응답의 ``document`` 서브트리만 입력으로 받는다. Figma API 응답
바깥의 HTTP/인증 관심사는 figma_client.py 가 맡는다.
"""

from __future__ import annotations

import re
from typing import Any

from .figma_client import FigmaFrame

_CANDIDATE_TYPES = {"FRAME", "COMPONENT", "INSTANCE", "SECTION"}
_MOBILE_WIDTH_RANGE = (280, 600)
_NAME_PREFIX_RE = re.compile(r"^(\d+)[_\-.\s]")


def find_node(document: dict[str, Any], node_id: str) -> tuple[dict[str, Any], int] | None:
    """document 트리 전체에서 node_id 를 찾아 (node, page_index) 를 돌려준다."""
    for page_index, page in enumerate(document.get("children") or []):
        stack = [page]
        while stack:
            node = stack.pop()
            if node.get("id") == node_id:
                return node, page_index
            stack.extend(node.get("children") or [])
    return None


def frame_from_node(node: dict[str, Any], page_index: int) -> FigmaFrame | None:
    """규칙 3: visible != false, width/height > 0 인 노드만 허용한다."""
    if node.get("visible") is False:
        return None
    box = node.get("absoluteBoundingBox") or {}
    width, height = box.get("width") or 0, box.get("height") or 0
    if width <= 0 or height <= 0:
        return None
    return FigmaFrame(
        node_id=node["id"],
        name=node.get("name") or "",
        width=round(width),
        height=round(height),
        page_index=page_index,
        x=box.get("x", 0.0),
        y=box.get("y", 0.0),
    )


def _collect_mobile_screen_roots(
    node: dict[str, Any], page_index: int
) -> list[FigmaFrame]:
    """Collect outermost portrait phone frames without descending into their UI layers."""
    if node.get("visible") is False:
        return []
    if node.get("type") in _CANDIDATE_TYPES:
        frame = frame_from_node(node, page_index)
        if (
            frame is not None
            and _MOBILE_WIDTH_RANGE[0] <= frame.width <= _MOBILE_WIDTH_RANGE[1]
            and frame.height > frame.width
        ):
            return [frame]

    frames: list[FigmaFrame] = []
    for child in node.get("children") or []:
        frames.extend(_collect_mobile_screen_roots(child, page_index))
    return frames


def collect_candidate_frames(
    document: dict[str, Any], *, expand_mobile_containers: bool = False
) -> list[FigmaFrame]:
    """Collect top-level candidates, optionally expanding phone-flow containers."""
    frames: list[FigmaFrame] = []
    for page_index, page in enumerate(document.get("children") or []):
        for child in page.get("children") or []:
            if expand_mobile_containers:
                nested = _collect_mobile_screen_roots(child, page_index)
                is_section = child.get("type") == "SECTION"
                if len(nested) >= 2 or (is_section and nested):
                    frames.extend(nested)
                    continue
            if child.get("type") not in _CANDIDATE_TYPES:
                continue
            frame = frame_from_node(child, page_index)
            if frame is not None:
                frames.append(frame)
    return frames


def _name_prefix(name: str) -> int | None:
    match = _NAME_PREFIX_RE.match(name)
    return int(match.group(1)) if match else None


def select_frames(frames: list[FigmaFrame], *, target: str, max_frames: int) -> list[FigmaFrame]:
    """규칙 4-6: 모바일 폭 우선 -> 이름 숫자 prefix 또는 캔버스 순서 -> 최대 개수."""
    candidates = list(frames)

    if target == "mobile-web":
        narrow = [
            frame
            for frame in candidates
            if _MOBILE_WIDTH_RANGE[0] <= frame.width <= _MOBILE_WIDTH_RANGE[1]
            and frame.height > frame.width
        ]
        if narrow:
            candidates = narrow

    prefixed = [(frame, _name_prefix(frame.name)) for frame in candidates]
    if prefixed and all(prefix is not None for _, prefix in prefixed):
        ordered = [frame for frame, _ in sorted(prefixed, key=lambda item: item[1])]
    else:
        ordered = sorted(candidates, key=lambda frame: (frame.page_index, frame.y, frame.x))

    return ordered[:max_frames]


def _prototype_destinations(node: dict[str, Any]) -> list[str]:
    """노드와 자식의 prototype reaction에서 목적지 ID를 선언 순서대로 모은다."""
    destinations: list[str] = []
    stack = [node]
    while stack:
        current = stack.pop()
        for reaction in current.get("reactions") or []:
            action = reaction.get("action") or {}
            destination_id = action.get("destinationId")
            if destination_id and destination_id not in destinations:
                destinations.append(destination_id)
        # Figma 응답 순서를 유지하기 위해 DFS stack에는 역순으로 넣는다.
        stack.extend(reversed(current.get("children") or []))
    return destinations


def select_prototype_flow(
    document: dict[str, Any], *, flow_name: str | None, max_frames: int
) -> list[FigmaFrame]:
    """Canvas의 flowStartingPoints에서 시작해 prototype 전환 그래프를 순회한다.

    Figma REST 응답은 Flow 자체를 별도 객체로 주지 않고 각 Canvas의
    ``flowStartingPoints``와 노드 ``reactions[].action.destinationId``로 표현한다.
    이름이 주어지면 대소문자를 무시한 완전 일치, 부분 일치 순으로 시작점을 고른다.
    """
    starts: list[tuple[str, str]] = []
    for page in document.get("children") or []:
        for point in page.get("flowStartingPoints") or []:
            node_id = point.get("nodeId")
            if node_id:
                starts.append((node_id, (point.get("name") or "").strip()))

    if not starts:
        return []

    selected_start = starts[0]
    query = (flow_name or "").strip().casefold()
    if query:
        exact = [item for item in starts if item[1].casefold() == query]
        partial = [item for item in starts if query in item[1].casefold()]
        matches = exact or partial
        if not matches:
            available = ", ".join(name or node_id for node_id, name in starts[:5])
            raise ValueError(f"Flow를 찾을 수 없습니다. 사용 가능한 Flow: {available}")
        selected_start = matches[0]

    pending = [selected_start[0]]
    visited: set[str] = set()
    frames: list[FigmaFrame] = []
    while pending and len(frames) < max_frames:
        node_id = pending.pop(0)
        if node_id in visited:
            continue
        visited.add(node_id)
        found = find_node(document, node_id)
        if found is None:
            continue
        node, page_index = found
        frame = frame_from_node(node, page_index)
        if frame is not None:
            frames.append(frame)
        for destination_id in _prototype_destinations(node):
            if destination_id not in visited and destination_id not in pending:
                pending.append(destination_id)

    return frames
