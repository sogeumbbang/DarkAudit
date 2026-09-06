"""Public, synthetic inputs for reviewer demos; analysis uses the regular APIs."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()
ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "frontend/public/dark-pattern-demo"
APK_PATH = ROOT / "demo/assets/darkaudit-demo.apk"
DEFAULT_FIGMA_URL = "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/DarkAudit-Mobile-Banking-Mockup"


@router.get("/demo/web/{filename}", name="demo_web")
def demo_web(filename: str) -> FileResponse:
    if filename not in {"index.html", "style.css", "demo.js"}:
        raise HTTPException(404, "Demo asset not found")
    return FileResponse(WEB_DIR / filename)


@router.get("/demo/darkaudit-demo.apk", name="demo_apk")
def demo_apk() -> FileResponse:
    if not APK_PATH.is_file():
        raise HTTPException(404, "Demo APK not installed")
    return FileResponse(
        APK_PATH, media_type="application/vnd.android.package-archive", filename="darkaudit-demo.apk"
    )


@router.get("/api/v1/demo-inputs")
def demo_inputs() -> dict:
    figma_url = os.getenv("DARKAUDIT_DEMO_FIGMA_URL", DEFAULT_FIGMA_URL).strip()
    figma_ready = bool(figma_url and os.getenv("FIGMA_ACCESS_TOKEN"))
    android_ready = bool(
        APK_PATH.is_file() and os.getenv("BROWSERSTACK_USERNAME") and os.getenv("BROWSERSTACK_ACCESS_KEY")
    )
    return {
        "website": {
            "url": str(router.url_path_for("demo_web", filename="index.html")) + "?step=4",
            "available": True,
        },
        "figma": {
            "fileUrl": figma_url,
            "available": figma_ready,
            "reason": None if figma_ready else "Figma 데모를 준비 중입니다. 다른 입력으로 먼저 체험해 주세요.",
        },
        "android": {
            "downloadUrl": str(router.url_path_for("demo_apk")),
            "available": android_ready,
            "reason": None if android_ready else "Android 데모를 준비 중입니다. 다른 입력으로 먼저 체험해 주세요.",
        },
    }
