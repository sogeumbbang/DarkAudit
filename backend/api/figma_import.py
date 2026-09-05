"""Figma 파일을 스크린 이미지로 내려받아 기존 분석 파이프라인에 넘긴다.

docs/figma_fastapi_handoff.md 7절의 import_and_analyze_figma() 구현이다.
Figma 는 입력 수집기일 뿐이며, 분석은 service.analyze_run_screens() 를
그대로 재사용한다(업로드 경로와 동일 로직).
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

from backend.app.models import AuditRun, FlowType, Screen

from . import service
from .figma_client import FigmaClient, FigmaError, FigmaFrame, FigmaSettings, parse_figma_url
from .figma_frames import (
    collect_candidate_frames,
    find_node,
    frame_from_node,
    select_frames,
    select_prototype_flow,
)
from .schemas import ImportFigmaRequest
from .store import SessionLocal

LOGGER = logging.getLogger(__name__)

_MAX_IMAGE_BYTES = 10 * 1024 * 1024
_MAX_TOTAL_BYTES = 50 * 1024 * 1024
_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")


def _sanitize_filename(name: str) -> str:
    cleaned = _UNSAFE_FILENAME.sub("-", name).strip("-.")
    return cleaned[:80] or "frame"


def _validate_png(path: Path) -> None:
    try:
        with Image.open(path) as image:
            image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise FigmaError(f"invalid image file: {path.name}", status=422) from exc


def _resolve_frames(
    client: FigmaClient, file_key: str, node_id: str | None, request: ImportFigmaRequest, settings: FigmaSettings
) -> list[FigmaFrame]:
    file_doc = client.get_file(file_key)
    document = file_doc.get("document") or {}

    if node_id is not None:
        # 규칙 1: node-id 가 있으면 타입 제한 없이 해당 노드 하나만 쓴다.
        found = find_node(document, node_id)
        if found is None:
            raise FigmaError(f"node-id not found in file: {node_id}", status=404)
        node, page_index = found
        frame = frame_from_node(node, page_index)
        return [frame] if frame is not None else []

    if request.selectionMode == "prototype-flow":
        try:
            return select_prototype_flow(
                document, flow_name=request.flowName, max_frames=settings.max_frames
            )
        except ValueError as exc:
            raise FigmaError(str(exc), status=422) from exc

    candidates = collect_candidate_frames(document)
    return select_frames(candidates, target=request.target, max_frames=settings.max_frames)


def import_and_analyze_figma(
    job_id: str,
    run_id: int,
    *,
    audit_id: str,
    request: ImportFigmaRequest,
) -> None:
    try:
        service._mark_running(job_id, run_id, 10)

        settings = FigmaSettings.from_env()
        client = FigmaClient(settings)
        file_key, node_id = parse_figma_url(str(request.fileUrl))

        frames = _resolve_frames(client, file_key, node_id, request, settings)
        if not frames:
            raise FigmaError("분석 가능한 프레임이 없습니다.", status=422)

        service._update_job(job_id, progress=35)
        images = client.render_frames(file_key, [frame.node_id for frame in frames])

        with SessionLocal() as session:
            run = session.get(AuditRun, run_id)
            if run is None:
                raise ValueError("Import run no longer exists")

            target_dir = service.FIGMA_DIR / audit_id / f"run-{run.version}"
            target_dir.mkdir(parents=True, exist_ok=True)

            manifest_frames: list[dict[str, Any]] = []
            local_paths: list[Path] = []
            missing: list[str] = []
            total_bytes = 0

            for index, frame in enumerate(frames, 1):
                render_url = images.get(frame.node_id)
                if not render_url:
                    missing.append(frame.name)
                    continue

                filename = f"{len(local_paths) + 1:02d}_{_sanitize_filename(frame.name)}.png"
                path = target_dir / filename
                total_bytes += client.download_render(render_url, path, max_bytes=_MAX_IMAGE_BYTES)
                if total_bytes > _MAX_TOTAL_BYTES:
                    raise FigmaError("프레임 이미지가 허용 크기를 초과했습니다.", status=422)
                _validate_png(path)

                screen_index = len(local_paths) + 1
                run.screens.append(
                    Screen(
                        flow_type=FlowType.join,
                        screen_index=screen_index,
                        flow_step=frame.name,
                        image_path=service.public_image_path(path),
                        viewport_w=frame.width,
                        viewport_h=frame.height,
                    )
                )
                local_paths.append(path)
                manifest_frames.append(
                    {
                        "nodeId": frame.node_id,
                        "name": frame.name,
                        "width": frame.width,
                        "height": frame.height,
                        "image": filename,
                    }
                )

            if not local_paths:
                raise FigmaError("Figma 프레임 렌더링에 실패했습니다.", status=422)

            (target_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "fileKey": file_key,
                        "selectionMode": request.selectionMode,
                        "frames": manifest_frames,
                        "missing": missing,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            session.commit()
            LOGGER.info(
                "Figma import stored screens: job_id=%s audit_id=%s file_key=%s node_count=%d missing=%d",
                job_id, audit_id, file_key[:6], len(local_paths), len(missing),
            )

        service._update_job(job_id, progress=60)
        service.analyze_run_screens(job_id, run_id, local_paths)
    except Exception as exc:
        service._fail_job(job_id, run_id, exc)
