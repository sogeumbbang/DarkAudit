"""Figma REST API 클라이언트과 fileUrl 파서.

docs/figma_fastapi_handoff.md 4절은 사용자별 OAuth 를 요구하지만, 이 모듈은
그중 인증과 무관한 부분(URL 파싱, 파일/렌더 조회, 다운로드)만 구현한다.
지금은 서버 전역 Personal Access Token(FIGMA_ACCESS_TOKEN) 하나로 인증한다 —
문서가 "로컬 개발자가 자기 파일을 점검하는 임시 수단"이라 부른 방식이다.
사용자별 OAuth 로 옮길 때는 FigmaSettings.access_token 을 요청 시점에
로그인한 사용자의 토큰으로 주입하도록만 바꾸면 된다.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

_FILE_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_NODE_ID_RE = re.compile(r"^\d+-\d+$")
_ALLOWED_HOSTS = {"figma.com", "www.figma.com"}
_RETRY_STATUS = {429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3


class InvalidFigmaUrlError(ValueError):
    """fileUrl 검증 실패. 호출부는 이를 HTTP 400 으로 매핑한다."""


class FigmaError(Exception):
    """Figma API/다운로드 실패. status 는 docs 10절 오류 매핑에 쓰인다."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def parse_figma_url(url: str) -> tuple[str, str | None]:
    """fileUrl 에서 (file_key, node_id) 를 뽑는다.

    node_id 는 쿼리스트링의 API 미형식(``3-2``)을 API 형식(``3:2``)으로 바꿔 돌려준다.
    """
    parsed = httpx.URL(url)
    if parsed.scheme != "https":
        raise InvalidFigmaUrlError("scheme must be https")
    if parsed.host not in _ALLOWED_HOSTS:
        raise InvalidFigmaUrlError(f"host not allowed: {parsed.host}")

    match = re.match(r"^/(?:design|file)/([^/]+)", parsed.path)
    if not match:
        raise InvalidFigmaUrlError("path must be /design/{file_key}/...")
    file_key = match.group(1)
    if not _FILE_KEY_RE.match(file_key):
        raise InvalidFigmaUrlError("invalid file key")

    node_id: str | None = None
    raw_node = parsed.params.get("node-id")
    if raw_node:
        if not _NODE_ID_RE.match(raw_node):
            raise InvalidFigmaUrlError("invalid node-id")
        node_id = raw_node.replace("-", ":", 1)

    return file_key, node_id


@dataclass(frozen=True, slots=True)
class FigmaFrame:
    node_id: str
    name: str
    width: int
    height: int
    page_index: int
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class FigmaSettings:
    access_token: str
    api_base_url: str = "https://api.figma.com/v1"
    timeout_seconds: float = 30.0
    render_scale: int = 2
    max_frames: int = 6

    @classmethod
    def from_env(cls) -> "FigmaSettings":
        load_dotenv()  # ai/config.py::AISettings.from_env() 와 동일한 관례
        token = os.getenv("FIGMA_ACCESS_TOKEN")
        if not token:
            raise FigmaError("FIGMA_ACCESS_TOKEN is not configured", status=401)
        return cls(
            access_token=token,
            api_base_url=os.getenv("FIGMA_API_BASE_URL", "https://api.figma.com/v1"),
            timeout_seconds=float(os.getenv("FIGMA_HTTP_TIMEOUT_SECONDS", "30")),
            render_scale=int(os.getenv("FIGMA_RENDER_SCALE", "2")),
            max_frames=int(os.getenv("FIGMA_MAX_FRAMES", "6")),
        )


class FigmaClient:
    def __init__(
        self,
        settings: FigmaSettings,
        *,
        client: httpx.Client | None = None,
        sleep: Any = time.sleep,
    ) -> None:
        self.settings = settings
        self._sleep = sleep
        self._client = client or httpx.Client(
            base_url=settings.api_base_url,
            timeout=settings.timeout_seconds,
        )

    def get_file(self, file_key: str) -> dict[str, Any]:
        return self._request("GET", f"/files/{file_key}")

    def render_frames(self, file_key: str, node_ids: list[str]) -> dict[str, str | None]:
        payload = self._request(
            "GET",
            f"/images/{file_key}",
            params={
                "ids": ",".join(node_ids),
                "format": "png",
                "scale": self.settings.render_scale,
                "contents_only": "true",
            },
        )
        if payload.get("err"):
            raise FigmaError(f"Figma render error: {payload['err']}")
        return payload.get("images") or {}

    def download_render(self, url: str, destination: Path, *, max_bytes: int) -> int:
        if not url.startswith("https://"):
            raise FigmaError("render url must be https")
        destination.parent.mkdir(parents=True, exist_ok=True)

        last_error: Exception | None = None
        for attempt in range(2):
            try:
                with httpx.stream(
                    "GET", url, timeout=self.settings.timeout_seconds, follow_redirects=True
                ) as response:
                    response.raise_for_status()
                    size = 0
                    with destination.open("wb") as handle:
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > max_bytes:
                                raise FigmaError(f"render exceeds {max_bytes} bytes", status=422)
                            handle.write(chunk)
                return size
            except FigmaError:
                raise
            except Exception as exc:  # noqa: BLE001 - retried once below
                last_error = exc
                if attempt == 0:
                    self._sleep(0.5)
        raise FigmaError(f"failed to download render: {last_error}") from last_error

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        headers = {"X-Figma-Token": self.settings.access_token, **kwargs.pop("headers", {})}
        last_error: Exception | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = self._client.request(method, path, headers=headers, **kwargs)
            except httpx.TimeoutException as exc:
                last_error = exc
                self._backoff(attempt)
                continue

            if response.status_code in _RETRY_STATUS and attempt < _MAX_ATTEMPTS - 1:
                last_error = FigmaError("retryable Figma error", status=response.status_code)
                self._backoff(attempt)
                continue
            if response.status_code >= 400:
                raise FigmaError(f"Figma API error {response.status_code}", status=response.status_code)
            return response.json()
        raise FigmaError(f"Figma API request failed: {last_error}")

    def _backoff(self, attempt: int) -> None:
        self._sleep(min(0.5 * (2**attempt), 4.0))
