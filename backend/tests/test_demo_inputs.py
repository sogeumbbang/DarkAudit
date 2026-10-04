from __future__ import annotations

import io
import hashlib
import os
import unittest
import zipfile
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.demo_inputs import DEFAULT_FIGMA_FLOW, DEFAULT_FIGMA_URL, router


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
        self.assertEqual(data["website"]["url"], "/demo/web/index.html?step=1")
        self.assertEqual(data["figma"]["fileUrl"], DEFAULT_FIGMA_URL)
        self.assertEqual(data["figma"]["selectionMode"], "prototype-flow")
        self.assertEqual(data["figma"]["flowName"], DEFAULT_FIGMA_FLOW)
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
                self.assertEqual(data["selectionMode"], "all-frames")
                self.assertIsNone(data["flowName"])

    def test_figma_demo_does_not_pin_a_shared_links_selected_screen(self):
        for query in ("node-id=3-2", "node-id=3%3A2", "node-id=3-2&node-id=3-5"):
            with self.subTest(query=query), patch.dict(os.environ, {
                "FIGMA_ACCESS_TOKEN": "configured",
                "DARKAUDIT_DEMO_FIGMA_URL": f"{DEFAULT_FIGMA_URL}?{query}&t=share#section",
            }, clear=True):
                data = self.client.get("/api/v1/demo-inputs").json()["figma"]
            self.assertEqual(data["fileUrl"], f"{DEFAULT_FIGMA_URL}?t=share#section")
            self.assertTrue(data["available"])

    def test_web_assets_load_and_other_files_are_not_exposed(self):
        html = self.client.get("/demo/web/index.html?step=1")
        self.assertEqual(html.status_code, 200)
        self.assertIn('src="demo.js"', html.text)
        self.assertEqual(self.client.get("/demo/web/demo.js").status_code, 200)
        self.assertEqual(self.client.get("/demo/web/scenarios.js").status_code, 200)
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

    def test_paired_catalog_assets_are_real_pngs_with_stable_stage_names(self):
        from PIL import Image
        cases = self.client.get("/api/v1/demo-inputs").json()["cases"]
        self.assertEqual({case["id"] for case in cases}, {"pet", "travel", "credit"})
        for case in cases:
            self.assertEqual([item["id"] for item in case["variants"]], ["risky", "partial", "revised"])
            names = [[screen["flowStep"] for screen in variant["screens"]] for variant in case["variants"]]
            self.assertEqual(names[0], names[1])
            self.assertEqual(names[0], names[2])
            for variant in case["variants"]:
                self.assertEqual(len(variant["screens"]), 6)
                for screen in variant["screens"]:
                    response = self.client.get(screen["url"])
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(hashlib.sha256(response.content).hexdigest(), screen["sha256"])
                    with Image.open(io.BytesIO(response.content)) as image:
                        self.assertEqual(image.format, "PNG")
                        self.assertEqual(image.width, 786)
            self.assertNotEqual(case["variants"][0]["screens"][1]["sha256"], case["variants"][1]["screens"][1]["sha256"])
            self.assertNotEqual(case["variants"][1]["screens"][3]["sha256"], case["variants"][2]["screens"][3]["sha256"])
        for path in ("unknown/risky/01.png", "pet/unknown/01.png", "pet/risky/manifest.json", "pet/risky/07.png"):
            self.assertEqual(self.client.get(f"/demo/cases/{path}").status_code, 404)
        self.assertEqual(self.client.get("/demo/web/variants.js").status_code, 200)

    def test_native_versions_are_distinct_downloads_and_flows(self):
        with patch.dict(os.environ, {"FIGMA_ACCESS_TOKEN": "key", "BROWSERSTACK_USERNAME": "user", "BROWSERSTACK_ACCESS_KEY": "key"}):
            data = self.client.get("/api/v1/demo-inputs").json()
        self.assertEqual(len({v['flowName'] for v in data['figma']['variants']}), 3)
        hashes = []
        for variant in data['android']['variants']:
            self.assertTrue(variant['available'])
            response = self.client.get(variant['downloadUrl'])
            self.assertEqual(response.status_code, 200)
            with zipfile.ZipFile(io.BytesIO(response.content)) as apk:
                self.assertIn('classes.dex', apk.namelist())
            hashes.append(hashlib.sha256(response.content).hexdigest())
        self.assertEqual(len(set(hashes)), 3)
        self.assertEqual(self.client.get('/demo/android/unknown.apk').status_code, 404)
        self.assertEqual(self.client.get('/demo/android/.env').status_code, 404)
