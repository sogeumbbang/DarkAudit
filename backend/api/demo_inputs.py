"""Public, synthetic inputs for reviewer demos; analysis uses the regular APIs."""

from __future__ import annotations

import os
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()
ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "frontend/public/dark-pattern-demo"
APK_PATH = ROOT / "demo/assets/darkaudit-demo.apk"
CASES_DIR = ROOT / "frontend/public/demo-cases"
DEFAULT_FIGMA_URL = "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/DarkAudit-Mobile-Banking-Mockup"
DEFAULT_FIGMA_FLOW = "릿 크레딧 · 6단계"


@router.get("/demo/web/{filename}", name="demo_web")
def demo_web(filename: str) -> FileResponse:
    if filename not in {"index.html", "style.css", "demo.js", "scenarios.js", "variants.js"}:
        raise HTTPException(404, "Demo asset not found")
    return FileResponse(WEB_DIR / filename)


@router.get("/demo/cases/{scenario}/{variant}/{filename}")
def demo_case_image(scenario: str, variant: str, filename: str) -> FileResponse:
    if scenario not in {"pet", "travel", "credit"} or variant not in {"risky", "partial", "revised"} or filename not in {f"{i:02d}.png" for i in range(1, 7)}:
        raise HTTPException(404, "Demo asset not found")
    path = CASES_DIR / scenario / variant / filename
    if not path.is_file():
        raise HTTPException(404, "Demo asset not installed")
    return FileResponse(path, media_type="image/png")


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
    if figma_url:
        # Let the demo's selection mode choose its scope, rather than a shared
        # link pinning one screen (or overriding the named prototype start).
        parsed = urlsplit(figma_url)
        query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
                 if key != "node-id"]
        figma_url = urlunsplit(parsed._replace(query=urlencode(query)))
    built_in_file = urlsplit(figma_url).path.split("/")[1:3] == [
        "design", "YtP0tCCij8KTBOiZXkzh9B",
    ]
    figma_ready = bool(figma_url and os.getenv("FIGMA_ACCESS_TOKEN"))
    android_ready = bool(
        APK_PATH.is_file() and os.getenv("BROWSERSTACK_USERNAME") and os.getenv("BROWSERSTACK_ACCESS_KEY")
    )
    return {
        "cases": json.loads((CASES_DIR / "manifest.json").read_text())["cases"] if (CASES_DIR / "manifest.json").is_file() else [],
        "website": {
            "url": str(router.url_path_for("demo_web", filename="index.html")) + "?step=1",
            "available": True,
        },
        "figma": {
            "fileUrl": figma_url,
            "selectionMode": "prototype-flow" if built_in_file else "all-frames",
            "flowName": DEFAULT_FIGMA_FLOW if built_in_file else None,
            "available": figma_ready,
            "reason": None if figma_ready else "Figma 데모를 준비 중입니다. 다른 입력으로 먼저 체험해 주세요.",
        },
        "android": {
            "downloadUrl": str(router.url_path_for("demo_apk")),
            "available": android_ready,
            "reason": None if android_ready else "Android 데모를 준비 중입니다. 다른 입력으로 먼저 체험해 주세요.",
        },
    }
