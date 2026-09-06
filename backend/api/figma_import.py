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
from dataclasses import replace
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
    select_prototype_paths,
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
    client: FigmaClient, file_key: str, node_id: str | None, request: ImportFigmaRequest, settings: FigmaSettings, document: dict[str, Any] | None = None
) -> list[FigmaFrame]:
    if document is None:
        document = client.get_file(file_key).get("document") or {}

    if request.selectionMode == "prototype-flow":
        try:
            return select_prototype_flow(
                document, flow_name=request.flowName, max_frames=settings.max_frames,
                start_node_id=node_id,
            )
        except ValueError as exc:
            raise FigmaError(str(exc), status=422) from exc

    if node_id is not None:
        # Figma 공유 링크는 실제 화면뿐 아니라 Canvas(예: 0:1)나 여러 화면을
        # 감싼 Section/Frame을 가리키는 경우가 흔하다. 컨테이너 링크라면 그 아래
        # 화면 후보를 선택하고, leaf/group 링크일 때만 기존처럼 노드 하나를 쓴다.
        found = find_node(document, node_id)
        if found is None:
            raise FigmaError(f"node-id not found in file: {node_id}", status=404)
        node, page_index = found
        frame = frame_from_node(node, page_index)

        expands_mobile_container = request.target in {"mobile-web", "app"}
        if frame is not None and (
            not expands_mobile_container
            or (280 <= frame.width <= 600 and frame.height > frame.width)
        ):
            return [frame]

        scoped_document = {"children": [node]}
        nested = collect_candidate_frames(
            scoped_document,
            expand_mobile_containers=expands_mobile_container,
        )
        if nested:
            return select_frames(
                nested,
                target=request.target,
                max_frames=settings.max_frames,
            )
        return [frame] if frame is not None else []

    candidates = collect_candidate_frames(
        document,
        expand_mobile_containers=request.target in {"mobile-web", "app"},
    )
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

        document = client.get_file(file_key).get("document") or {}
        paths, selection_warnings = [], []
        if request.selectionMode == "prototype-flow":
            paths, selection_warnings = select_prototype_paths(
                document, flow_name=request.flowName, max_frames=settings.max_frames, start_node_id=node_id,
            )
            frames = list({frame.node_id:frame for path in paths for frame in path}.values())
        else:
            all_frames = _resolve_frames(client, file_key, node_id, request, replace(settings, max_frames=10000), document)
            frames = all_frames[:settings.max_frames]
            paths = [frames]
            selection_warnings.append("figma_canvas_order_not_verified_journey")
            if len(all_frames) > len(frames):
                selection_warnings.append(f"figma_omitted_frames:{len(all_frames)-len(frames)}")
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
                        analysis_context={"profile":request.target,"state_id":(
                            frame.node_id if request.selectionMode == "prototype-flow" else "unordered-canvas"),
                                          "evidence":_frame_evidence(document, frame)},
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
            index_by_node = {item["nodeId"]:index for index,item in enumerate(manifest_frames,1)}
            run.analysis_summary = {"source":"figma", "warnings":selection_warnings +
                ([f"figma_render_missing:{len(missing)}"] if missing else []),
                "paths":[[index_by_node[frame.node_id] for frame in path if frame.node_id in index_by_node] for path in paths]}
            session.commit()
            LOGGER.info(
                "Figma import stored screens: job_id=%s audit_id=%s file_key=%s node_count=%d missing=%d",
                job_id, audit_id, file_key[:6], len(local_paths), len(missing),
            )

        service._update_job(job_id, progress=60)
        service.analyze_run_screens(job_id, run_id, local_paths)
    except Exception as exc:
        service._fail_job(job_id, run_id, exc)


def _frame_evidence(document: dict[str, Any], frame: FigmaFrame) -> list[dict[str, Any]]:
    found = find_node(document, frame.node_id)
    if found is None:
        return []
    elements = []
    stack = [found[0]]
    while stack:
        node = stack.pop()
        if node.get("visible") is False:
            continue
        box = node.get("absoluteBoundingBox") or {}
        text = node.get("characters")
        if text and box.get("width",0) > 0 and box.get("height",0) > 0:
            left, top = max(0,box.get("x",0)-frame.x), max(0,box.get("y",0)-frame.y)
            right = min(frame.width, box.get("x",0)-frame.x+box["width"])
            bottom = min(frame.height, box.get("y",0)-frame.y+box["height"])
            if right > left and bottom > top:
                elements.append({"element_id":node["id"],"text":text,"source":"figma-text",
                    "bbox":[left/frame.width,top/frame.height,(right-left)/frame.width,(bottom-top)/frame.height]})
        stack.extend(reversed(node.get("children") or []))
    return elements
