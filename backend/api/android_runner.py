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
        )


@dataclass(frozen=True, slots=True)
class AndroidCapture:
    image_path: Path
    flow_step: str
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class _TapCandidate:
    x: int
    y: int
    label: str
    signature: str
    score: int


def _tap_candidates(source: str, attempted: set[str]) -> list[_TapCandidate]:
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
        candidates.append(
            _TapCandidate((left + right) // 2, (top + bottom) // 2, label, signature, score)
        )
    return sorted(candidates, key=lambda item: (-item.score, item.y, item.x))


class BrowserStackAndroidRunner:
    upload_url = "https://api-cloud.browserstack.com/app-automate/upload"
    webdriver_url = "https://hub-cloud.browserstack.com/wd/hub"

    def __init__(self, settings: AndroidRunnerSettings, *, client: httpx.Client | None = None):
        self.settings = settings
        self.client = client or httpx.Client(
            auth=(settings.username, settings.access_key), timeout=settings.command_timeout
        )

    def capture(self, apk_path: Path, target_dir: Path, *, audit_id: str, goal: str | None) -> list[AndroidCapture]:
        target_dir.mkdir(parents=True, exist_ok=True)
        app_url = self._upload(apk_path, audit_id)
        session_id = self._create_session(app_url, audit_id, goal)
        try:
            return self._explore(session_id, target_dir)
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

    def _explore(self, session_id: str, target_dir: Path) -> list[AndroidCapture]:
        captures: list[AndroidCapture] = []
        image_hashes: set[str] = set()
        attempted: set[str] = set()
        for step in range(self.settings.max_screens):
            image = self._screenshot(session_id)
            digest = hashlib.sha256(image).hexdigest()
            if digest not in image_hashes:
                path = target_dir / f"{len(captures) + 1:02d}.png"
                path.write_bytes(image)
                try:
                    with Image.open(path) as screenshot:
                        width, height = screenshot.size
                        screenshot.verify()
                except (UnidentifiedImageError, OSError) as exc:
                    raise AndroidRunnerError("Android 스크린샷이 올바른 PNG가 아닙니다.") from exc
                captures.append(
                    AndroidCapture(path, "앱 실행" if not captures else f"자동 탐색 {len(captures)}", width, height)
                )
                image_hashes.add(digest)
            if step + 1 >= self.settings.max_screens:
                break

            source_response = self._request("GET", f"{self.webdriver_url}/session/{session_id}/source")
            source = source_response.json().get("value") or ""
            candidates = _tap_candidates(source, attempted)
            if not candidates:
                break
            candidate = candidates[0]
            attempted.add(candidate.signature)
            self._tap(session_id, candidate.x, candidate.y)
            time.sleep(1.5)
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
