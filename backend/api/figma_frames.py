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

    if target in {"mobile-web", "app"}:
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
    """Normalize REST interactions and legacy reactions, including conditions.

    Only navigation edges lead to another screen; overlays, media actions and
    component state swaps are not subsequent customer journey steps.
    """
    destinations: list[str] = []

    def visit_action(action: dict[str, Any]) -> None:
        if action.get("type") == "CONDITIONAL":
            for block in action.get("conditionalBlocks") or []:
                for nested in block.get("actions") or []:
                    visit_action(nested)
        elif action.get("type") == "NODE" and action.get("navigation", "NAVIGATE") == "NAVIGATE":
            destination = action.get("destinationId")
            if destination and destination not in destinations:
                destinations.append(destination)

    stack = [node]
    while stack:
        current = stack.pop()
        if current.get("visible") is False:
            continue
        for interaction in current.get("interactions", current.get("reactions", [])) or []:
            actions = interaction.get("actions")
            if actions is None:
                actions = [interaction.get("action") or {}]
            for action in actions:
                visit_action(action)
        # Older REST exports exposed only transitionNodeID.
        legacy = current.get("transitionNodeID")
        if legacy and legacy not in destinations:
            destinations.append(legacy)
        stack.extend(reversed(current.get("children") or []))
    return destinations


def select_prototype_paths(
    document: dict[str, Any], *, flow_name: str | None, max_frames: int,
    start_node_id: str | None = None, max_paths: int = 8,
) -> tuple[list[list[FigmaFrame]], list[str]]:
    """Keep branches separate and report every bounded or unavailable traversal."""
    starts: list[tuple[str, str]] = []
    for page in document.get("children") or []:
        for point in page.get("flowStartingPoints") or []:
            if point.get("nodeId"):
                starts.append((point["nodeId"], (point.get("name") or "").strip()))
    if start_node_id:
        found = find_node(document, start_node_id)
        if found is None:
            raise ValueError(f"node-id not found in file: {start_node_id}")
        node, _ = found
        if node.get("type") not in {"CANVAS", "SECTION", "DOCUMENT"}:
            starts = [(start_node_id, flow_name or "selected node")]
        else:
            # A container link scopes the start, not the reachable destinations.
            def descendants(item: dict[str, Any]) -> set[str]:
                return {item.get("id", "")} | set().union(
                    *(descendants(child) for child in item.get("children") or [])
                )
            ids = descendants(node)
            starts = [item for item in starts if item[0] in ids]
    if not starts:
        return [], ["figma_no_prototype_start"]
    query = (flow_name or "").strip().casefold()
    if query and not (start_node_id and len(starts) == 1 and starts[0][0] == start_node_id):
        exact = [item for item in starts if item[1].casefold() == query]
        partial = [item for item in starts if query in item[1].casefold()]
        if not (exact or partial):
            available = ", ".join(name or node_id for node_id, name in starts[:5])
            raise ValueError(f"Flow를 찾을 수 없습니다. 사용 가능한 Flow: {available}")
        starts = exact or partial

    paths: list[list[FigmaFrame]] = []
    warnings: list[str] = []

    def walk(node_id: str, path: list[FigmaFrame], visited: set[str]) -> None:
        if len(paths) >= max_paths:
            warnings.append("figma_path_limit")
            return
        if node_id in visited:
            warnings.append("figma_cycle")
            if path:
                paths.append(path)
            return
        found = find_node(document, node_id)
        frame = frame_from_node(*found) if found else None
        if frame is None:
            warnings.append("figma_missing_destination")
            if path:
                paths.append(path)
            return
        current = [*path, frame]
        destinations = _prototype_destinations(found[0])
        if not destinations or len(current) >= max_frames:
            paths.append(current)
            if destinations:
                warnings.append("figma_screen_limit")
            return
        for destination in destinations:
            walk(destination, current, visited | {node_id})

    walk(starts[0][0], [], set())
    return paths, sorted(set(warnings))


def select_prototype_flow(
    document: dict[str, Any], *, flow_name: str | None, max_frames: int,
    start_node_id: str | None = None,
) -> list[FigmaFrame]:
    """Compatibility view of the first path, never a concatenation of branches."""
    paths, _ = select_prototype_paths(
        document, flow_name=flow_name, max_frames=max_frames, start_node_id=start_node_id
    )
    return paths[0] if paths else []
