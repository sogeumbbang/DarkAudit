"""BrowserStack App Automate를 이용한 안전한 Android 화면 수집기."""

from __future__ import annotations

import base64
import hashlib
import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, UnidentifiedImageError

_BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
_BLOCKED_LABELS = (
    "결제", "구매", "주문", "신청", "가입", "제출", "로그인", "회원가입", "송금", "인증",
    "pay", "purchase", "buy", "order", "submit", "apply", "sign up", "login", "transfer",
)
_PREFERRED_LABELS = (
    "다음", "계속", "선택", "보기", "더보기", "시작", "next", "continue", "select", "view", "start",
)


class AndroidRunnerError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AndroidRunnerSettings:
    username: str
    access_key: str
    device_name: str = "Google Pixel 8"
    platform_version: str = "14.0"
    max_screens: int = 5
    command_timeout: float = 180.0
    max_actions: int = 20
    settle_timeout: float = 8.0
    poll_interval: float = 0.25

    @classmethod
    def from_env(cls) -> "AndroidRunnerSettings":
        username = os.getenv("BROWSERSTACK_USERNAME")
        access_key = os.getenv("BROWSERSTACK_ACCESS_KEY")
        if not username or not access_key:
            raise AndroidRunnerError(
                "Android 자동 진단에는 BROWSERSTACK_USERNAME과 "
                "BROWSERSTACK_ACCESS_KEY 설정이 필요합니다."
            )
        return cls(
            username=username,
            access_key=access_key,
            device_name=os.getenv("BROWSERSTACK_ANDROID_DEVICE", "Google Pixel 8"),
            platform_version=os.getenv("BROWSERSTACK_ANDROID_VERSION", "14.0"),
            max_screens=max(1, min(int(os.getenv("ANDROID_MAX_SCREENS", "5")), 5)),
            max_actions=max(1, min(int(os.getenv("ANDROID_MAX_ACTIONS", "20")), 50)),
        )


@dataclass(frozen=True, slots=True)
class AndroidCapture:
    image_path: Path
    flow_step: str
    width: int
    height: int
    ui_elements: tuple[dict[str, Any], ...] = ()
    state_id: str = ""
    path_id: str = "main"


@dataclass(frozen=True, slots=True)
class _TapCandidate:
    x: int
    y: int
    label: str
    signature: str
    score: int


def _tap_candidates(source: str, attempted: set[str], goal: str | None = None) -> list[_TapCandidate]:
    try:
        root = ET.fromstring(source)
    except ET.ParseError as exc:
        raise AndroidRunnerError("Android UI 계층을 읽지 못했습니다.") from exc

    candidates: list[_TapCandidate] = []
    for node in root.iter():
        attrs = node.attrib
        if attrs.get("clickable") != "true" or attrs.get("enabled", "true") != "true":
            continue
        label = " ".join(
            value.strip()
            for value in (attrs.get("text", ""), attrs.get("content-desc", ""))
            if value.strip()
        )
        normalized = label.casefold()
        if any(blocked in normalized for blocked in _BLOCKED_LABELS):
            continue
        match = _BOUNDS_RE.fullmatch(attrs.get("bounds", ""))
        if not match:
            continue
        left, top, right, bottom = map(int, match.groups())
        if right <= left or bottom <= top:
            continue
        signature = f"{attrs.get('resource-id', '')}|{label}|{left},{top},{right},{bottom}"
        if signature in attempted:
            continue
        if normalized in _PREFERRED_LABELS:
            score = 20
        elif any(word in normalized for word in _PREFERRED_LABELS):
            score = 10
        else:
            score = 0
        if label:
            score += 2
        goal_terms = [term for term in re.findall(r"[\w]+", (goal or "").casefold()) if len(term) >= 2]
        score += 5 * sum(term in normalized for term in goal_terms)
        candidates.append(
            _TapCandidate((left + right) // 2, (top + bottom) // 2, label, signature, score)
        )
    return sorted(candidates, key=lambda item: (-item.score, item.y, item.x))


class BrowserStackAndroidRunner:
    upload_url = "https://api-cloud.browserstack.com/app-automate/upload"
    webdriver_url = "https://hub-cloud.browserstack.com/wd/hub"

    def __init__(self, settings: AndroidRunnerSettings, *, client: httpx.Client | None = None):
        self.settings = settings
        self.last_warnings: list[str] = []
        self.last_paths: list[list[int]] = []
        self.client = client or httpx.Client(
            auth=(settings.username, settings.access_key), timeout=settings.command_timeout
        )

    def capture(self, apk_path: Path, target_dir: Path, *, audit_id: str, goal: str | None) -> list[AndroidCapture]:
        target_dir.mkdir(parents=True, exist_ok=True)
        app_url = self._upload(apk_path, audit_id)
        session_id = self._create_session(app_url, audit_id, goal)
        try:
            return self._explore(session_id, target_dir, goal=goal)
        finally:
            try:
                self._request("DELETE", f"{self.webdriver_url}/session/{session_id}")
            except AndroidRunnerError:
                pass

    def _upload(self, apk_path: Path, audit_id: str) -> str:
        with apk_path.open("rb") as handle:
            response = self.client.post(
                self.upload_url,
                files={"file": (apk_path.name, handle, "application/vnd.android.package-archive")},
                data={"custom_id": f"darkaudit-{audit_id}"[:100]},
            )
        self._ensure_success(response, "APK 업로드")
        app_url = response.json().get("app_url")
        if not isinstance(app_url, str) or not app_url.startswith("bs://"):
            raise AndroidRunnerError("BrowserStack가 APK 식별자를 반환하지 않았습니다.")
        return app_url

    def _create_session(self, app_url: str, audit_id: str, goal: str | None) -> str:
        payload = {
            "capabilities": {
                "alwaysMatch": {
                    "platformName": "Android",
                    "appium:app": app_url,
                    "appium:deviceName": self.settings.device_name,
                    "appium:platformVersion": self.settings.platform_version,
                    "appium:automationName": "UiAutomator2",
                    "appium:autoGrantPermissions": True,
                    "appium:newCommandTimeout": 180,
                    "bstack:options": {
                        "userName": self.settings.username,
                        "accessKey": self.settings.access_key,
                        "projectName": "DarkAudit",
                        "buildName": audit_id,
                        "sessionName": (goal or "안전 UI 자동 탐색")[:120],
                        "debug": True,
                    },
                }
            }
        }
        response = self.client.post(f"{self.webdriver_url}/session", json=payload)
        self._ensure_success(response, "Android 기기 세션 생성")
        data = response.json()
        session_id = data.get("sessionId") or (data.get("value") or {}).get("sessionId")
        if not session_id:
            raise AndroidRunnerError("BrowserStack가 Android 세션 ID를 반환하지 않았습니다.")
        return str(session_id)

    def _stable_source(self, session_id: str) -> str:
        deadline = time.monotonic() + self.settings.settle_timeout
        previous = None
        stable = 0
        while True:
            response = self._request("GET", f"{self.webdriver_url}/session/{session_id}/source")
            source = response.json().get("value") or ""
            stable = stable + 1 if source == previous else 0
            if stable >= 2:
                return source
            if time.monotonic() >= deadline:
                self.last_warnings.append("android_screen_not_stable")
                return source
            previous = source
            time.sleep(self.settings.poll_interval)

    def _explore(self, session_id: str, target_dir: Path, *, goal: str | None = None) -> list[AndroidCapture]:
        captures: list[AndroidCapture] = []
        attempted: dict[str, set[str]] = {}
        seen_states: set[str] = set()
        scrolled: set[str] = set()
        backed: set[str] = set()
        path_number = 0
        current_path: list[int] = []
        index_by_state: dict[str, int] = {}
        for step in range(self.settings.max_actions + 1):
            source = self._stable_source(session_id)
            # XML includes selected state and text, unlike a global button ID.
            state_id = hashlib.sha256(source.encode()).hexdigest()
            image = self._screenshot(session_id)
            if state_id not in seen_states:
                path = target_dir / f"{len(captures) + 1:02d}.png"
                path.write_bytes(image)
                try:
                    with Image.open(path) as screenshot:
                        width, height = screenshot.size
                        screenshot.verify()
                except (UnidentifiedImageError, OSError) as exc:
                    raise AndroidRunnerError("Android 스크린샷이 올바른 PNG가 아닙니다.") from exc
                captures.append(AndroidCapture(
                    path, "앱 실행" if not captures else f"자동 탐색 {len(captures)}", width, height,
                    _ui_elements(source, width, height), state_id, f"path-{path_number}",
                ))
                path.with_suffix(".xml").write_text(source, encoding="utf-8")
                seen_states.add(state_id)
                index_by_state[state_id] = len(captures)
            index = index_by_state[state_id]
            if index in current_path:
                current_path = current_path[:current_path.index(index) + 1]
            else:
                current_path.append(index)
            if len(captures) >= self.settings.max_screens:
                self.last_warnings.append("android_screen_limit")
                break
            if step >= self.settings.max_actions:
                self.last_warnings.append("android_action_limit")
                break
            tried = attempted.setdefault(state_id, set())
            candidates = _tap_candidates(source, tried, goal)
            if candidates:
                candidate = candidates[0]
                tried.add(candidate.signature)
                self._tap(session_id, candidate.x, candidate.y)
            elif 'scrollable="true"' in source and state_id not in scrolled:
                scrolled.add(state_id)
                self._request("POST", f"{self.webdriver_url}/session/{session_id}/actions", json={
                    "actions": [{"type":"pointer", "id":"finger", "parameters":{"pointerType":"touch"},
                        "actions":[{"type":"pointerMove","duration":0,"x":width//2,"y":height*3//4},
                                   {"type":"pointerDown","button":0},
                                   {"type":"pointerMove","duration":500,"x":width//2,"y":height//4},
                                   {"type":"pointerUp","button":0}]}]})
            elif len(seen_states) > 1 and state_id not in backed:
                backed.add(state_id)
                self.last_paths.append(list(current_path))
                path_number += 1
                self._request("POST", f"{self.webdriver_url}/session/{session_id}/back")
            else:
                self.last_warnings.append("android_no_safe_navigation")
                break
        if current_path and current_path not in self.last_paths:
            self.last_paths.append(current_path)
        self.last_warnings = sorted(set(self.last_warnings))
        return captures

    def _screenshot(self, session_id: str) -> bytes:
        response = self._request("GET", f"{self.webdriver_url}/session/{session_id}/screenshot")
        encoded = response.json().get("value")
        if not isinstance(encoded, str):
            raise AndroidRunnerError("Android 스크린샷을 가져오지 못했습니다.")
        try:
            return base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise AndroidRunnerError("Android 스크린샷 응답이 손상되었습니다.") from exc

    def _tap(self, session_id: str, x: int, y: int) -> None:
        actions: dict[str, Any] = {
            "actions": [{
                "type": "pointer", "id": "finger", "parameters": {"pointerType": "touch"},
                "actions": [
                    {"type": "pointerMove", "duration": 0, "x": x, "y": y},
                    {"type": "pointerDown", "button": 0},
                    {"type": "pause", "duration": 100},
                    {"type": "pointerUp", "button": 0},
                ],
            }]
        }
        self._request("POST", f"{self.webdriver_url}/session/{session_id}/actions", json=actions)

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        response = self.client.request(method, url, **kwargs)
        self._ensure_success(response, "Android 자동 탐색")
        return response

    @staticmethod
    def _ensure_success(response: httpx.Response, action: str) -> None:
        if response.status_code < 400:
            return
        detail = ""
        try:
            payload = response.json()
            detail = str(payload.get("message") or (payload.get("value") or {}).get("message") or "")
        except ValueError:
            pass
        raise AndroidRunnerError(f"{action} 실패 ({response.status_code}){': ' + detail[:300] if detail else ''}")


def _ui_elements(source: str, width: int, height: int) -> tuple[dict[str, Any], ...]:
    """Normalize Android accessibility evidence without inventing CSS styles."""
    try:
        root = ET.fromstring(source)
    except ET.ParseError as exc:
        raise AndroidRunnerError("Android UI 계층을 읽지 못했습니다.") from exc
    elements = []
    for index, node in enumerate(root.iter()):
        attrs = node.attrib
        bounds = _BOUNDS_RE.fullmatch(attrs.get("bounds", ""))
        if not bounds or attrs.get("displayed") == "false":
            continue
        left, top, right, bottom = map(int, bounds.groups())
        left, top, right, bottom = max(0,left), max(0,top), min(width,right), min(height,bottom)
        if right <= left or bottom <= top:
            continue
        text = (attrs.get("text") or attrs.get("content-desc") or "").strip()
        element_type = "checkbox" if attrs.get("checkable") == "true" else "button" if attrs.get("clickable") == "true" else "text"
        elements.append({"element_id": f"android-{index}", "element_type": element_type,
            "text": text, "bbox": [left/width,top/height,(right-left)/width,(bottom-top)/height],
            "state": {"checked": attrs.get("checked") == "true", "enabled": attrs.get("enabled") != "false"},
            "source": "android-accessibility"})
    return tuple(elements)
