"""Durable job progress, independent of long-running analysis transactions."""

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

from .schemas import JobDto


class JobAlreadyRunning(ValueError):
    pass


@contextmanager
def connection(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(directory / "jobs.sqlite3", timeout=30)
    try:
        db.execute("""CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, audit_id TEXT NOT NULL, run_id TEXT NOT NULL,
            status TEXT NOT NULL, payload TEXT NOT NULL)""")
        db.execute("DROP INDEX IF EXISTS one_active_job_per_run")
        db.execute("DROP INDEX IF EXISTS one_active_or_successful_job_per_run")
        db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS unique_live_job_per_audit_run
            ON jobs(audit_id, run_id) WHERE status IN ('queued', 'analyzing', 'completed')""")
        with db:
            yield db
    finally:
        db.close()


def create(directory: Path, job: JobDto) -> None:
    with connection(directory) as db:
        try:
            db.execute("INSERT INTO jobs VALUES (?, ?, ?, ?, ?)",
                       (job.jobId, job.auditId, job.runId, job.status, job.model_dump_json()))
        except sqlite3.IntegrityError as exc:
            raise JobAlreadyRunning("이미 분석 중인 회차입니다.") from exc


def get(directory: Path, job_id: str) -> JobDto:
    with connection(directory) as db:
        row = db.execute("SELECT payload FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise KeyError(job_id)
    return JobDto.model_validate_json(row[0])


def update(directory: Path, job_id: str, change: Callable[[JobDto], None]) -> None:
    with connection(directory) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT payload FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        job = JobDto.model_validate_json(row[0])
        change(job)
        db.execute("UPDATE jobs SET status = ?, payload = ? WHERE id = ?",
                   (job.status, job.model_dump_json(), job_id))


def latest(directory: Path, audit_id: str) -> str | None:
    with connection(directory) as db:
        row = db.execute("SELECT id FROM jobs WHERE audit_id = ? ORDER BY rowid DESC LIMIT 1",
                         (audit_id,)).fetchone()
    return row[0] if row else None


def recover(directory: Path) -> None:
    with connection(directory) as db:
        rows = db.execute("SELECT id, payload FROM jobs WHERE status IN ('queued', 'analyzing')").fetchall()
        for job_id, payload in rows:
            data = json.loads(payload)
            data.update(status="failed", progress=100,
                        error="서버 재시작으로 검사가 중단되었습니다. 수집한 기록을 확인한 뒤 다시 실행해 주세요.")
            if data.get("explorationStage"):
                data["explorationStage"] = "failed"
            db.execute("UPDATE jobs SET status = 'failed', payload = ? WHERE id = ?",
                       (json.dumps(data), job_id))


def delete_for_audit(directory: Path, audit_id: str) -> None:
    with connection(directory) as db:
        db.execute("DELETE FROM jobs WHERE audit_id = ?", (audit_id,))


def has_active(directory: Path, audit_id: str) -> bool:
    with connection(directory) as db:
        return db.execute("SELECT 1 FROM jobs WHERE audit_id = ? AND status IN ('queued', 'analyzing') LIMIT 1",
                          (audit_id,)).fetchone() is not None
