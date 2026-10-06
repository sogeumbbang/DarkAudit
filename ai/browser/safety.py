"""Network and interaction guardrails for autonomous browser exploration."""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from .models import BrowserAction, BrowserActionType

Resolver = Callable[[str], Iterable[str]]


class UnsafeUrlError(ValueError):
    pass


class UnsafeActionError(ValueError):
    pass


def _default_resolver(hostname: str) -> Iterable[str]:
    return {item[4][0] for item in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)}


@dataclass(slots=True)
class UrlSafetyPolicy:
    allow_private_network: bool = False
    resolver: Resolver = _default_resolver

    def validate(self, url: str) -> str:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"}:
            raise UnsafeUrlError("Only http and https URLs are allowed")
        if not parsed.hostname:
            raise UnsafeUrlError("URL must include a hostname")
        if parsed.username or parsed.password:
            raise UnsafeUrlError("Credentials embedded in URLs are not allowed")
        try:
            addresses = tuple(self.resolver(parsed.hostname))
        except OSError as exc:
            raise UnsafeUrlError(f"Could not resolve hostname: {parsed.hostname}") from exc
        if not addresses:
            raise UnsafeUrlError(f"Could not resolve hostname: {parsed.hostname}")
        if not self.allow_private_network:
            for raw_address in addresses:
                address = ipaddress.ip_address(raw_address.split("%", 1)[0])
                if not address.is_global:
                    raise UnsafeUrlError(f"Private or non-public address is blocked: {address}")
        return url

    @staticmethod
    def origin(url: str) -> tuple[str, str, int]:
        parsed = urlsplit(url)
        default_port = 443 if parsed.scheme == "https" else 80
        return parsed.scheme.lower(), (parsed.hostname or "").lower(), parsed.port or default_port

    def validate_same_origin(self, candidate: str, origin_url: str) -> str:
        self.validate(candidate)
        if self.origin(candidate) != self.origin(origin_url):
            raise UnsafeUrlError("Cross-origin navigation is blocked during smart exploration")
        return candidate


_RISKY_CLICK_TERMS = (
    "결제",
    "구매",
    "주문",
    "가입",
    "등록",
    "제출",
    "송금",
    "예약 확정",
    "동의",
    "pay",
    "purchase",
    "buy now",
    "place order",
    "submit",
    "sign up",
    "create account",
    "transfer",
    "confirm booking",
    "accept",
    "agree",
)


@dataclass(frozen=True, slots=True)
class ActionSafetyPolicy:
    max_scroll_factor: int = 2
    # Only for sandboxes with no network egress (the bundled synthetic demo),
    # where e.g. a consent button cannot have a real-world effect.
    allowed_click_terms: frozenset[str] = frozenset()

    def validate(
        self,
        action: BrowserAction,
        *,
        viewport_width: int,
        viewport_height: int,
        target: dict[str, Any] | None = None,
    ) -> None:
        allowed = {
            BrowserActionType.CLICK,
            BrowserActionType.SCROLL,
            BrowserActionType.WAIT,
            BrowserActionType.KEYPRESS,
            BrowserActionType.MOVE,
            BrowserActionType.SCREENSHOT,
        }
        if action.type not in allowed:
            raise UnsafeActionError(f"Action {action.type.value!r} is disabled for unattended audits")

        if action.type in {BrowserActionType.CLICK, BrowserActionType.MOVE, BrowserActionType.SCROLL}:
            if action.x is None or action.y is None:
                raise UnsafeActionError(f"Action {action.type.value!r} requires coordinates")
            if not 0 <= action.x < viewport_width or not 0 <= action.y < viewport_height:
                raise UnsafeActionError("Action coordinates are outside the current viewport")

        if action.type is BrowserActionType.CLICK:
            if action.button != "left" or action.keys:
                raise UnsafeActionError("Only unmodified left clicks are allowed")
            self._validate_click_target(target)

        if action.type is BrowserActionType.SCROLL:
            limit_x = viewport_width * self.max_scroll_factor
            limit_y = viewport_height * self.max_scroll_factor
            if abs(action.scroll_x) > limit_x or abs(action.scroll_y) > limit_y:
                raise UnsafeActionError("Scroll delta exceeds the per-action limit")
            if action.keys:
                raise UnsafeActionError("Modified scrolling is not allowed")

        if action.type is BrowserActionType.KEYPRESS:
            safe_keys = {"ESC", "ESCAPE", "TAB", "ARROWUP", "ARROWDOWN", "PAGEUP", "PAGEDOWN"}
            if not action.keys or any(key.upper() not in safe_keys for key in action.keys):
                raise UnsafeActionError("Only navigation and dismissal keys are allowed")

    def _validate_click_target(self, target: dict[str, Any] | None) -> None:
        if not target:
            return
        element_type = str(target.get("type", "")).lower()
        if element_type in {"submit", "file", "password"}:
            raise UnsafeActionError(f"Clicking input type {element_type!r} is blocked")
        label = " ".join(
            str(target.get(key, "")) for key in ("text", "ariaLabel", "title", "value")
        ).casefold()
        blocked = (term for term in _RISKY_CLICK_TERMS if term not in self.allowed_click_terms)
        if any(term.casefold() in label for term in blocked):
            raise UnsafeActionError("Potentially consequential click is blocked")
