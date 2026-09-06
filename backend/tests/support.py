"""Per-test API resources: no import-time environment or shared database mutation."""

import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.api import android_import, figma_import, main, service, store


class IsolatedApiTestCase(unittest.TestCase):
    def setUp(self):
        super().setUp()
        resources = ExitStack()
        self.addCleanup(resources.close)
        root = Path(
            resources.enter_context(
                tempfile.TemporaryDirectory(prefix="darkaudit-api-test-")
            )
        )
        url = f"sqlite:///{root / 'test.db'}"
        engine = create_engine(url, connect_args={"check_same_thread": False})
        resources.callback(engine.dispose)
        sessions = sessionmaker(bind=engine, expire_on_commit=False)
        resources.enter_context(
            patch.dict(
                "os.environ",
                {
                    "DARKAUDIT_PROVIDER": "fake",
                    "FIGMA_ACCESS_TOKEN": "test-token",
                    "FIGMA_MAX_FRAMES": "5",
                    "DARKAUDIT_OCR_PROVIDER": "none",
                },
            )
        )
        for module in (main, service, store, figma_import, android_import):
            resources.enter_context(patch.object(module, "SessionLocal", sessions))
        resources.enter_context(patch.object(store, "_engine", engine))
        resources.enter_context(patch.object(store, "DB_URL", url))
        resources.enter_context(patch.object(service, "_jobs", {}))
        for module in (main, service, store):
            for key, suffix in [
                ("DATA_DIR", ""),
                ("UPLOAD_DIR", "uploads"),
                ("CAPTURE_DIR", "captures"),
                ("FIGMA_DIR", "figma"),
                ("ANDROID_DIR", "android"),
            ]:
                if hasattr(module, key):
                    directory = root / suffix
                    directory.mkdir(exist_ok=True)
                    resources.enter_context(patch.object(module, key, directory))
        for route in main.app.routes:
            if getattr(route, "path", None) == "/artifacts":
                resources.enter_context(patch.object(route.app, "directory", str(root)))
                resources.enter_context(
                    patch.object(route.app, "all_directories", [str(root)])
                )
        self.client = resources.enter_context(TestClient(main.app))
