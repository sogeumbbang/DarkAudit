import io
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import BackgroundTasks
from PIL import Image

from backend.api import jobs, main, service, store
from backend.tests.support import IsolatedApiTestCase
from backend.tests.test_api import run_verified_analysis


class JobLifecycleTest(IsolatedApiTestCase):
    def setUp(self):
        super().setUp()
        self.audit_id = self.client.post("/api/v1/audits", json={"name": "Lifecycle", "platform": "mobile-web"}).json()["id"]
        data = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(data, format="PNG")
        self.client.post(f"/api/v1/audits/{self.audit_id}/screens", files={"files": ("screen.png", data.getvalue(), "image/png")})

    def test_retry_success_clears_failed_attempt_and_is_complete(self):
        with patch("backend.api.service.create_provider", side_effect=RuntimeError("temporary outage")):
            first = self.client.post(f"/api/v1/audits/{self.audit_id}/analyze").json()
        self.assertEqual(service.get_job(first["jobId"]).status, "failed")
        retry = run_verified_analysis(self.client, self.audit_id, detecting=False)
        self.assertEqual(service.get_job(retry["jobId"]).status, "completed")
        result = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertTrue(result["analysisSummary"]["complete"], result["analysisSummary"])
        self.assertNotIn("analysis_failed", result["analysisSummary"]["warnings"])
        self.assertEqual(result["latestJobId"], retry["jobId"])

    def test_same_run_is_atomically_claimed_before_worker_starts(self):
        with store.SessionLocal() as session:
            run_id = store.get_audit(session, self.audit_id).runs[-1].id
        def enqueue(_):
            try:
                return service.create_job(self.audit_id, run_id).jobId
            except jobs.JobAlreadyRunning:
                return None
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(enqueue, range(6)))
        self.assertEqual(sum(item is not None for item in results), 1)
        response = self.client.post(f"/api/v1/audits/{self.audit_id}/analyze")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.delete(f"/api/v1/audits/{self.audit_id}").status_code, 409)

    def test_analysis_reports_progress_between_start_and_completion(self):
        seen = []
        update = service._update_job
        def record(job_id, **changes):
            if "progress" in changes:
                seen.append(changes["progress"])
            update(job_id, **changes)
        with patch("backend.api.service._update_job", side_effect=record):
            job = run_verified_analysis(self.client, self.audit_id, detecting=False)
        self.assertEqual(service.get_job(job["jobId"]).status, "completed")
        steps = [value for value in seen if 20 < value < 100]
        self.assertGreaterEqual(len(steps), 2, seen)
        self.assertEqual(seen, sorted(seen))

    def test_second_job_waits_for_the_heavy_work_slot(self):
        job = main.analyze(self.audit_id, BackgroundTasks())
        with store.SessionLocal() as session:
            run_id = store.get_audit(session, self.audit_id).runs[-1].id
        with ThreadPoolExecutor(max_workers=1) as pool:
            with service._HEAVY_WORK:
                worker = pool.submit(service.analyze_uploaded_screens, job.jobId, run_id,
                                     [service.DATA_DIR / "01.png"])
                deadline = time.monotonic() + 5
                while service.get_job(job.jobId).status != "queued" and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertEqual(service.get_job(job.jobId).status, "queued")
            worker.result(timeout=10)
        # The missing image fails the analysis, but only once the slot was free.
        self.assertEqual(service.get_job(job.jobId).status, "failed")
        self.assertFalse(service._HEAVY_WORK.locked())

    def test_progress_survives_module_reload_and_interruption_is_queryable(self):
        job = main.analyze(self.audit_id, BackgroundTasks())
        service._update_job(job.jobId, progress=42, explorationMode="smart", explorationStage="capturing")
        output = subprocess.check_output([
            sys.executable, "-c",
            "from backend.api.jobs import get; from pathlib import Path; import sys; print(get(Path(sys.argv[1]), sys.argv[2]).progress)",
            str(service.DATA_DIR), job.jobId,
        ], text=True)
        self.assertEqual(float(output.strip()), 42)
        service.recover_interrupted_runs()
        result = self.client.get(f"/api/v1/analysis-jobs/{job.jobId}").json()
        self.assertEqual(result["status"], "failed")
        self.assertIn("서버 재시작", result["error"])
        self.assertEqual(self.client.delete(f"/api/v1/audits/{self.audit_id}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/v1/analysis-jobs/{job.jobId}").status_code, 404)
