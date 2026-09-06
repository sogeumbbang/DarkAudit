"""Contracts shared by the browser driver and the Computer Use agent."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class ScanMode(str, Enum):
    QUICK = "quick"
    SMART = "smart"


class BrowserActionType(str, Enum):
    CLICK = "click"
    DOUBLE_CLICK = "double_click"
    SCROLL = "scroll"
    TYPE = "type"
    WAIT = "wait"
    KEYPRESS = "keypress"
    DRAG = "drag"
    MOVE = "move"
    SCREENSHOT = "screenshot"


@dataclass(frozen=True, slots=True)
class BrowserAction:
    type: BrowserActionType
    x: int | None = None
    y: int | None = None
    scroll_x: int = 0
    scroll_y: int = 0
    text: str | None = None
    keys: tuple[str, ...] = ()
    button: str = "left"
    path: tuple[tuple[int, int], ...] = ()

    @classmethod
    def from_api(cls, value: Any) -> "BrowserAction":
        def read(name: str, default: Any = None) -> Any:
            if isinstance(value, dict):
                return value.get(name, default)
            return getattr(value, name, default)

        raw_path = read("path", ()) or ()
        path: list[tuple[int, int]] = []
        for point in raw_path:
            if isinstance(point, dict):
                path.append((int(point["x"]), int(point["y"])))
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                path.append((int(point[0]), int(point[1])))
            else:
                path.append((int(getattr(point, "x")), int(getattr(point, "y"))))
        return cls(
            type=BrowserActionType(read("type")),
            x=_optional_int(read("x")),
            y=_optional_int(read("y")),
            scroll_x=int(read("scroll_x", 0) or 0),
            scroll_y=int(read("scroll_y", 0) or 0),
            text=read("text"),
            keys=tuple(read("keys", ()) or ()),
            button=str(read("button", "left") or "left"),
            path=tuple(path),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "x": self.x,
            "y": self.y,
            "scrollX": self.scroll_x,
            "scrollY": self.scroll_y,
            "text": self.text,
            "keys": list(self.keys),
            "button": self.button,
            "path": [list(point) for point in self.path],
        }


def _optional_int(value: Any) -> int | None:
    return None if value is None else int(value)


@dataclass(frozen=True, slots=True)
class CaptureArtifact:
    screen_id: str
    flow_step: str
    profile: str
    url: str
    title: str
    image_path: Path
    viewport_width: int
    viewport_height: int
    full_page: bool = False
    action: BrowserAction | None = None
    visible_text: str = ""
    interactive_elements: tuple[dict[str, Any], ...] = ()
    # Rule Engine 입력 형식(element_id/element_type/bbox/state/computed_style).
    # data/generator/extract_ui.py 의 스키마를 실제 페이지용으로 일반화한 것이다.
    dom_elements: tuple[dict[str, Any], ...] = ()
    fingerprint: str = ""
    state_id: str = ""
    path_id: str = "main"
    capture_height: int = 0
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "screenId": self.screen_id,
            "flowStep": self.flow_step,
            "profile": self.profile,
            "url": self.url,
            "title": self.title,
            "imagePath": str(self.image_path),
            "viewport": {"width": self.viewport_width, "height": self.viewport_height},
            "fullPage": self.full_page,
            "action": self.action.to_dict() if self.action else None,
            "visibleText": self.visible_text,
            "interactiveElements": list(self.interactive_elements),
            "domElements": list(self.dom_elements),
            "fingerprint": self.fingerprint,
            "stateId": self.state_id,
            "pathId": self.path_id,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True, slots=True)
class CaptureResult:
    audit_id: str
    profile: str
    mode: ScanMode
    artifacts: tuple[CaptureArtifact, ...]
    stop_reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "auditId": self.audit_id,
            "profile": self.profile,
            "mode": self.mode.value,
            "stopReason": self.stop_reason,
            "screens": [artifact.to_dict() for artifact in self.artifacts],
        }


@dataclass(frozen=True, slots=True)
class ComputerTurn:
    response_id: str
    call_id: str | None
    actions: tuple[BrowserAction, ...] = ()
    final_text: str = ""
    pending_safety_checks: tuple[dict[str, Any], ...] = field(default_factory=tuple)

    @property
    def is_finished(self) -> bool:
        return self.call_id is None
