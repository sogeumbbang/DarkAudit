"""APK를 원격 Android 기기에서 실행하고 캡처 화면을 공통 분석 파이프라인에 넘긴다."""

from __future__ import annotations

from pathlib import Path

from backend.app.models import AuditRun, FlowType, Screen

from . import service
from .android_runner import AndroidRunnerSettings, BrowserStackAndroidRunner
from .store import SessionLocal


def capture_and_analyze_android(
    job_id: str,
    run_id: int,
    *,
    audit_id: str,
    apk_path: Path,
    goal: str | None,
) -> None:
    try:
        service._mark_running(job_id, run_id, 8)
        settings = AndroidRunnerSettings.from_env()
        with SessionLocal() as session:
            run = session.get(AuditRun, run_id)
            if run is None:
                raise ValueError("Android run no longer exists")
            target_dir = service.ANDROID_DIR / audit_id / f"run-{run.version}" / "screens"

        runner = BrowserStackAndroidRunner(settings)
        captures = runner.capture(
            apk_path, target_dir, audit_id=audit_id, goal=goal
        )
        if not captures:
            raise ValueError("Android 앱에서 분석할 화면을 캡처하지 못했습니다.")

        service._update_job(job_id, progress=55)
        with SessionLocal() as session:
            run = session.get(AuditRun, run_id)
            if run is None:
                raise ValueError("Android run no longer exists")
            for index, capture in enumerate(captures, 1):
                run.screens.append(
                    Screen(
                        flow_type=FlowType.join,
                        screen_index=index,
                        flow_step=capture.flow_step,
                        image_path=service.public_image_path(capture.image_path),
                        viewport_w=capture.width,
                        viewport_h=capture.height,
                        analysis_context={"profile":"android", "state_id":capture.state_id,
                                          "path_id":capture.path_id, "evidence":list(capture.ui_elements)},
                    )
                )
            paths: dict[str,list[int]] = {}
            for index,capture in enumerate(captures,1):
                paths.setdefault(capture.path_id, []).append(index)
            run.analysis_summary = {"source":"android", "warnings":runner.last_warnings, "paths":getattr(runner,"last_paths",None) or list(paths.values())}
            session.commit()
        service.analyze_run_screens(job_id, run_id, [capture.image_path for capture in captures])
    except Exception as exc:
        service._fail_job(job_id, run_id, exc)
