from __future__ import annotations

import io
import os
import unittest
import zipfile
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.demo_inputs import DEFAULT_FIGMA_URL, router


class DemoInputsTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app, base_url="https://demo.example")
        self.addCleanup(self.client.close)

    def test_metadata_uses_public_backend_assets_without_exposing_credentials(self):
        with patch.dict(os.environ, {
            "FIGMA_ACCESS_TOKEN": "private-figma-key",
            "BROWSERSTACK_USERNAME": "private-username",
            "BROWSERSTACK_ACCESS_KEY": "private-browserstack-key",
        }, clear=True):
            response = self.client.get("/api/v1/demo-inputs")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["website"]["url"], "/demo/web/index.html?step=4")
        self.assertEqual(data["figma"]["fileUrl"], DEFAULT_FIGMA_URL)
        self.assertTrue(data["figma"]["available"])
        self.assertTrue(data["android"]["available"])
        self.assertNotIn("private-", response.text)

    def test_missing_configuration_disables_external_demos(self):
        with patch.dict(os.environ, {}, clear=True):
            data = self.client.get("/api/v1/demo-inputs").json()
        self.assertTrue(data["website"]["available"])
        for kind in ("figma", "android"):
            self.assertFalse(data[kind]["available"])
            self.assertTrue(data[kind]["reason"])

    def test_figma_file_can_be_overridden_or_disabled(self):
        for url in ("https://www.figma.com/design/another/Demo", ""):
            with self.subTest(url=url), patch.dict(os.environ, {
                "FIGMA_ACCESS_TOKEN": "configured", "DARKAUDIT_DEMO_FIGMA_URL": url,
            }, clear=True):
                data = self.client.get("/api/v1/demo-inputs").json()["figma"]
                self.assertEqual(data["fileUrl"], url)
                self.assertEqual(data["available"], bool(url))

    def test_web_assets_load_and_other_files_are_not_exposed(self):
        html = self.client.get("/demo/web/index.html?step=4")
        self.assertEqual(html.status_code, 200)
        self.assertIn('src="demo.js"', html.text)
        self.assertEqual(self.client.get("/demo/web/demo.js").status_code, 200)
        self.assertEqual(self.client.get("/demo/web/style.css").status_code, 200)
        for name in (".env", ".gitignore", "darkaudit-demo.apk"):
            self.assertEqual(self.client.get(f"/demo/web/{name}").status_code, 404)

    def test_download_is_a_packaged_android_app(self):
        response = self.client.get("/demo/darkaudit-demo.apk")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/vnd.android.package-archive")
        with zipfile.ZipFile(io.BytesIO(response.content)) as apk:
            self.assertIn("AndroidManifest.xml", apk.namelist())
            self.assertIn("classes.dex", apk.namelist())
            self.assertIsNone(apk.testzip())
