import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import service
from backend.app.models import Audit, AuditRun, Base, RunStatus


class InterruptedRunRecoveryTest(unittest.TestCase):
    def test_marks_only_non_terminal_runs_failed(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, expire_on_commit=False)

        with sessions() as session:
            audit = Audit(name="restart recovery", product_name="mobile-web")
            audit.runs.extend(
                [
                    AuditRun(version=1, status=RunStatus.PENDING),
                    AuditRun(version=2, status=RunStatus.RUNNING),
                    AuditRun(version=3, status=RunStatus.DONE),
                ]
            )
            session.add(audit)
            session.commit()

        with patch.object(service, "SessionLocal", sessions):
            self.assertEqual(service.recover_interrupted_runs(), 2)

        with sessions() as session:
            runs = session.query(AuditRun).order_by(AuditRun.version).all()
            self.assertEqual(
                [run.status for run in runs],
                [RunStatus.FAILED, RunStatus.FAILED, RunStatus.DONE],
            )
            self.assertIn("서버 재시작", runs[0].note)
            self.assertIn("서버 재시작", runs[1].note)


class CompatibleCaptureProfilesTest(unittest.TestCase):
    def test_mobile_path_drops_desktop_when_mobile_is_also_selected(self) -> None:
        self.assertEqual(
            service.compatible_capture_profiles(
                "https://example.com/m/product", ("desktop", "mobile")
            ),
            ("mobile",),
        )

    def test_mobile_path_rejects_desktop_only(self) -> None:
        with self.assertRaisesRegex(ValueError, "모바일 화면"):
            service.compatible_capture_profiles(
                "https://example.com/m/", ("desktop",)
            )

    def test_regular_path_preserves_requested_profiles(self) -> None:
        self.assertEqual(
            service.compatible_capture_profiles(
                "https://example.com/product", ("desktop", "mobile")
            ),
            ("desktop", "mobile"),
        )


if __name__ == "__main__":
    unittest.main()
