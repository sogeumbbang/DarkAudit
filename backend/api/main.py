"""FastAPI adapter consumed by the DarkAudit frontend."""

from __future__ import annotations

import json
import io
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from ai.browser.models import ScanMode
from ai.browser.safety import UnsafeUrlError, UrlSafetyPolicy
from backend.app.models import Audit, Finding, FindingStatus, FlowType, RunStatus, Screen
from backend.app.regression import compare

from .android_import import capture_and_analyze_android
from .android_runner import AndroidRunnerError, AndroidRunnerSettings
from .demo_inputs import router as demo_router
from .figma_client import InvalidFigmaUrlError, parse_figma_url
from .figma_import import import_and_analyze_figma
from .schemas import (
    AuditDto,
    CaptureAuditRequest,
    CreateAuditRequest,
    DashboardSummaryDto,
    FindingStatusRequest,
    ImportFigmaRequest,
    JobDto,
    RegressionDto,
)
from .service import (
    ANDROID_DIR,
    CAPTURE_DIR,
    DATA_DIR,
    FIGMA_DIR,
    UPLOAD_DIR,
    analyze_uploaded_screens,
    capture_and_analyze_url,
    compatible_capture_profiles,
    create_job,
    get_job,
    recover_interrupted_runs,
    next_run,
    public_image_path,
    rules_by_id,
)
from .store import SessionLocal, get_audit, init_db, list_audits, to_audit_dto, to_regression_dto

app = FastAPI(title="DarkAudit API", version="1.1.0")
app.include_router(demo_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "DARKAUDIT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")],
    # 로컬 개발용 localhost 외에, Vercel의 preview/anonymous 배포마다 서브도메인이
    # 매번 바뀌므로(temporary-*.vercel.app) 그때마다 DARKAUDIT_CORS_ORIGINS 를
    # 갱신하지 않아도 되도록 *.vercel.app 전체를 허용한다. allow_credentials=False
    # 라 쿠키/세션 위험은 없다.
    allow_origin_regex=r"^http://(?:localhost|127\.0\.0\.1):\d+$|^https://[a-z0-9-]+\.vercel\.app$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
DATA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/artifacts", StaticFiles(directory=DATA_DIR), name="artifacts")


@app.on_event("startup")
def startup() -> None:
    init_db()
    recover_interrupted_runs()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/audits", response_model=AuditDto, status_code=status.HTTP_201_CREATED)
def create_audit(payload: CreateAuditRequest) -> AuditDto:
    with SessionLocal() as session:
        audit = Audit(name=payload.name.strip(), product_name=payload.platform)
        session.add(audit)
        session.commit()
        return to_audit_dto(session, audit, rules_by_id())


@app.get("/api/v1/dashboard/summary", response_model=DashboardSummaryDto)
def dashboard_summary() -> DashboardSummaryDto:
    with SessionLocal() as session:
        audits = [to_audit_dto(session, audit, rules_by_id()) for audit in list_audits(session)]
        return DashboardSummaryDto(activeAuditId=audits[0].id if audits else None, audits=audits)


@app.delete("/api/v1/audits/{audit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit(audit_id: str) -> None:
    """
    진단 하나를 회차·화면·탐지까지 통째로 지운다.

    DB 는 relationship cascade(all, delete-orphan)가 정리하고, 화면 이미지는
    별도 파일이라 여기서 함께 지운다. 파일이 남으면 /artifacts 로 계속 노출되고
    디스크만 차지한다.

    경로는 URL 이 아니라 DB 에서 확인한 audit.id 로 만든다. 사용자가 넘긴
    문자열을 그대로 경로에 붙이면 상위 디렉터리로 빠져나갈 수 있다.
    """
    with SessionLocal() as session:
        try:
            audit = get_audit(session, audit_id)
        except KeyError:
            raise HTTPException(404, "Audit not found")
        directory_name = f"audit-{audit.id}"
        session.delete(audit)
        session.commit()

    for base in (UPLOAD_DIR, CAPTURE_DIR, FIGMA_DIR, ANDROID_DIR):
        shutil.rmtree(base / directory_name, ignore_errors=True)


@app.get("/api/v1/audits/{audit_id}/regression", response_model=RegressionDto)
def get_regression(
    audit_id: str,
    from_version: int | None = Query(default=None, alias="from", ge=1),
    to_version: int | None = Query(default=None, alias="to", ge=1),
) -> RegressionDto:
    with SessionLocal() as session:
        try:
            audit = get_audit(session, audit_id)
        except KeyError:
            raise HTTPException(404, "Audit not found")

        done_versions = sorted(r.version for r in audit.runs if r.status == RunStatus.DONE)
        if to_version is None:
            if not done_versions:
                raise HTTPException(409, "완료된 진단 회차가 없습니다.")
            to_version = done_versions[-1]
        if from_version is None:
            earlier = [v for v in done_versions if v < to_version]
            if not earlier:
                raise HTTPException(409, "비교할 이전 회차가 없습니다. 재진단 후 다시 시도해주세요.")
            from_version = earlier[-1]
        if from_version not in done_versions or to_version not in done_versions:
            raise HTTPException(404, "지정한 회차를 찾을 수 없거나 아직 완료되지 않았습니다.")

        # compare() 는 Finding.status(RESOLVED/REGRESSED)를 갱신하는 부작용이 있다.
        # 최신 두 회차 비교라면 분석 완료 시 이미 한 번 실행된 것과 동일한 결과를
        # 재계산해 재기록할 뿐이라 안전하다(결정적). from/to 를 임의로 지정해 건너뛴
        # 회차가 있는 경우에는 "지금까지 한 번이라도 해소된 적 있는지" 판정이 그
        # 임의 비교 기준으로 다시 쓰인다 — 순차 비교와 다른 결과가 나올 수 있음을
        # 알고 있어야 한다(문서 11절 범위 밖 edge case).
        try:
            report = compare(session, audit.id, from_version, to_version)
            session.commit()
        except ValueError as exc:
            raise HTTPException(404, str(exc))

        return to_regression_dto(session, report)


@app.post("/api/v1/audits/{audit_id}/screens", response_model=AuditDto)
async def upload_screens(
    audit_id: str,
    files: list[UploadFile] = File(...),
    screen_ids: list[str] = Form(default=[]),
    flow_steps: list[str] = Form(default=[]),
    x_darkaudit_screen_metadata: str | None = Header(default=None),
) -> AuditDto:
    if not 1 <= len(files) <= 5:
        raise HTTPException(400, "1개에서 5개의 이미지가 필요합니다.")
    metadata = []
    if x_darkaudit_screen_metadata:
        try:
            from urllib.parse import unquote
            metadata = json.loads(unquote(x_darkaudit_screen_metadata))
        except (ValueError, TypeError):
            raise HTTPException(400, "화면 메타데이터가 잘못되었습니다.")
    with SessionLocal() as session:
        try:
            audit = get_audit(session, audit_id)
        except KeyError:
            raise HTTPException(404, "Audit not found")
        run = next_run(session, audit.id, "uploaded screenshots")
        target = UPLOAD_DIR / audit_id / f"run-{run.version}"
        target.mkdir(parents=True, exist_ok=True)
        for index, upload in enumerate(files, 1):
            content = await upload.read()
            if len(content) > 10 * 1024 * 1024:
                raise HTTPException(413, "이미지는 개당 10MB까지 업로드할 수 있습니다.")
            suffix = Path(upload.filename or "screen.png").suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
                raise HTTPException(415, "PNG, JPG, WEBP 이미지만 지원합니다.")
            path = target / f"{index:02d}.png"
            try:
                with Image.open(io.BytesIO(content)) as source:
                    source.load()
                    normalized = ImageOps.exif_transpose(source).convert("RGB")
                    width, height = normalized.size
                    normalized.save(path, format="PNG")
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
                raise HTTPException(422, "이미지를 읽을 수 없습니다. 올바른 PNG, JPG, WEBP 파일을 선택해주세요.") from exc
            label = (
                flow_steps[index - 1] if index <= len(flow_steps)
                else metadata[index - 1].get("flowStep") if index <= len(metadata)
                else f"화면 {index}"
            )
            run.screens.append(Screen(
                flow_type=FlowType.join, screen_index=index, flow_step=label,
                image_path=public_image_path(path), viewport_w=width, viewport_h=height,
                analysis_context={"profile":audit.product_name or "unspecified", "state_id":str(index)},
            ))
        session.commit()
        return to_audit_dto(session, audit, rules_by_id())


@app.post("/api/v1/audits/{audit_id}/analyze", response_model=JobDto, status_code=202)
def analyze(audit_id: str, background: BackgroundTasks) -> JobDto:
    with SessionLocal() as session:
        try:
            audit = get_audit(session, audit_id)
        except KeyError:
            raise HTTPException(404, "Audit not found")
        run = audit.runs[-1] if audit.runs else None
        if run is None or not run.screens:
            raise HTTPException(409, "분석할 화면을 먼저 업로드해주세요.")
        if run.status not in {RunStatus.PENDING, RunStatus.FAILED}:
            raise HTTPException(409, "이미 분석 중이거나 완료된 run입니다.")
        local_paths = [DATA_DIR / screen.image_path.removeprefix("/artifacts/") for screen in run.screens]
        job = create_job(audit_id, run.id)
        background.add_task(analyze_uploaded_screens, job.jobId, run.id, local_paths)
        return job


@app.post("/api/v1/audits/{audit_id}/capture", response_model=JobDto, status_code=202)
def capture(audit_id: str, payload: CaptureAuditRequest, background: BackgroundTasks) -> JobDto:
    if payload.mode == "smart" and not os.getenv("DARKAUDIT_COMPUTER_MODEL"):
        raise HTTPException(400, "smart 모드에는 DARKAUDIT_COMPUTER_MODEL 설정이 필요합니다.")
    try:
        UrlSafetyPolicy().validate(str(payload.url))
        profiles = compatible_capture_profiles(str(payload.url), tuple(payload.profiles))
    except UnsafeUrlError as exc:
        raise HTTPException(400, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    with SessionLocal() as session:
        try:
            audit = get_audit(session, audit_id)
        except KeyError:
            raise HTTPException(404, "Audit not found")
        run = next_run(session, audit.id, f"URL: {payload.url}")
        session.commit()
        job = create_job(audit_id, run.id)
        background.add_task(
            capture_and_analyze_url, job.jobId, run.id,
            audit_id=audit_id, url=str(payload.url), profiles=profiles,
            mode=ScanMode(payload.mode), goal=payload.goal,
        )
        return job


@app.post("/api/v1/audits/{audit_id}/figma", response_model=JobDto, status_code=202)
def import_figma(audit_id: str, payload: ImportFigmaRequest, background: BackgroundTasks) -> JobDto:
    try:
        parse_figma_url(str(payload.fileUrl))
    except InvalidFigmaUrlError:
        raise HTTPException(400, "유효한 Figma design 링크가 아닙니다.")

    with SessionLocal() as session:
        try:
            audit = get_audit(session, audit_id)
        except KeyError:
            raise HTTPException(404, "Audit not found")
        run = next_run(session, audit.id, f"Figma: {payload.fileUrl}")
        session.commit()
        job = create_job(audit_id, run.id)
        background.add_task(
            import_and_analyze_figma, job.jobId, run.id, audit_id=audit_id, request=payload
        )
        return job


@app.post("/api/v1/audits/{audit_id}/mobile-app", response_model=JobDto, status_code=202)
async def analyze_mobile_app(
    audit_id: str,
    background: BackgroundTasks,
    app_file: UploadFile = File(..., alias="app"),
    goal: str | None = Form(default=None),
) -> JobDto:
    try:
        AndroidRunnerSettings.from_env()
    except AndroidRunnerError as exc:
        raise HTTPException(503, str(exc)) from exc
    if goal and len(goal) > 1000:
        raise HTTPException(422, "탐색 목표는 1000자까지 입력할 수 있습니다.")
    if Path(app_file.filename or "").suffix.lower() != ".apk":
        raise HTTPException(415, "APK 파일만 지원합니다.")

    ANDROID_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    total_bytes = 0
    first_chunk = True
    try:
        with tempfile.NamedTemporaryFile(dir=ANDROID_DIR, suffix=".apk", delete=False) as handle:
            temporary_path = Path(handle.name)
            while chunk := await app_file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > 100 * 1024 * 1024:
                    raise HTTPException(413, "APK는 100MB까지 업로드할 수 있습니다.")
                if first_chunk:
                    if not chunk.startswith(b"PK"):
                        raise HTTPException(415, "올바른 APK 파일이 아닙니다.")
                    first_chunk = False
                handle.write(chunk)
        if not total_bytes:
            raise HTTPException(400, "APK 파일이 비어 있습니다.")
        assert temporary_path is not None
        try:
            with zipfile.ZipFile(temporary_path) as archive:
                if "AndroidManifest.xml" not in archive.namelist():
                    raise HTTPException(415, "AndroidManifest.xml이 없는 APK입니다.")
        except zipfile.BadZipFile as exc:
            raise HTTPException(415, "올바른 APK 파일이 아닙니다.") from exc

        with SessionLocal() as session:
            try:
                audit = get_audit(session, audit_id)
            except KeyError:
                raise HTTPException(404, "Audit not found")
            run = next_run(session, audit.id, f"Android APK: {app_file.filename}")
            target_dir = ANDROID_DIR / audit_id / f"run-{run.version}"
            target_dir.mkdir(parents=True, exist_ok=True)
            apk_path = target_dir / "app.apk"
            temporary_path.replace(apk_path)
            temporary_path = None
            session.commit()
            job = create_job(audit_id, run.id)
            background.add_task(
                capture_and_analyze_android,
                job.jobId,
                run.id,
                audit_id=audit_id,
                apk_path=apk_path,
                goal=goal.strip() if goal else None,
            )
            return job
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


@app.get("/api/v1/analysis-jobs/{job_id}", response_model=JobDto)
def analysis_job(job_id: str) -> JobDto:
    try:
        return get_job(job_id)
    except KeyError:
        raise HTTPException(404, "Job not found")


@app.patch("/api/v1/findings/{finding_id}")
def update_finding(finding_id: str, payload: FindingStatusRequest) -> dict[str, str]:
    try:
        pk = int(finding_id.rsplit("-", 1)[-1])
    except ValueError:
        raise HTTPException(404, "Finding not found")
    with SessionLocal() as session:
        finding = session.get(Finding, pk)
        if finding is None:
            raise HTTPException(404, "Finding not found")
        finding.status = FindingStatus.RESOLVED if payload.status == "resolved" else FindingStatus.OPEN
        session.commit()
    return {"id": finding_id, "status": payload.status}
