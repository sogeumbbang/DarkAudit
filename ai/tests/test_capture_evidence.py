import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

from ai.browser.models import CaptureArtifact
from ai.browser.playwright_driver import _RULE_ENGINE_EXTRACT_JS
from ai.pipeline.web_audit import (
    analysis_batches,
    prepare_analysis_artifacts,
    batch_indices,
)
from backend.app.rule_engine.core import Element, RuleBase, Screen
from backend.app.rule_engine.checks import da04_checked, da07_asymmetry


class CaptureEvidenceTest(unittest.TestCase):
    def test_url_cli_pipeline_passes_dom_candidates_and_preserves_batch_results(self):
        from ai.pipeline.baseline import BaselineAuditPipeline
        from ai.pipeline.web_audit import URLAuditPipeline, URLCaptureResult
        from ai.browser.models import CaptureResult, ScanMode
        from ai.providers.fake_provider import FakeMultimodalProvider
        from unittest.mock import Mock

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "screen.png"
            Image.new("RGB", (400, 800), "white").save(path)
            artifact = CaptureArtifact(
                "first",
                "mobile: first",
                "mobile",
                "",
                "",
                path,
                400,
                800,
                dom_elements=(
                    {
                        "element_id": "option",
                        "element_type": "checkbox",
                        "text": "유료 옵션",
                        "bbox": [0.1, 0.2, 0.1, 0.1],
                        "state": {"checked": True},
                    },
                ),
            )
            capture = URLCaptureResult(
                "audit",
                "https://example.com",
                ScanMode.QUICK,
                (
                    CaptureResult(
                        "audit",
                        "mobile",
                        ScanMode.QUICK,
                        (artifact,),
                        "quick capture completed",
                    ),
                ),
            )
            pipeline = URLAuditPipeline(
                Mock(run=Mock(return_value=capture)),
                BaselineAuditPipeline(FakeMultimodalProvider()),
            )
            result = pipeline.run(audit_id="audit", url="https://example.com")
            self.assertEqual(result.analysis.candidates[0].rule_id, "DA-04")
            self.assertEqual(
                result.analysis.candidate_decisions[0].decision.value, "KEEP"
            )
            self.assertEqual(len(result.to_dict()["analysisBatches"]), 1)

    def test_batch_boundaries_preserve_adjacent_transitions(self):
        batches = batch_indices(14)
        for first in range(13):
            self.assertTrue(any({first, first + 1} <= set(b) for b in batches))
        self.assertEqual(batch_indices(3, 1), [[0], [1], [2]])

    def test_batches_keep_late_first_price_and_final_price_together(self):
        artifacts = tuple(
            CaptureArtifact(
                str(i),
                str(i),
                "mobile",
                "",
                "",
                Path("x"),
                400,
                800,
                state_id=str(i),
                dom_elements=({"element_type": "price"},) if i in (2, 11) else (),
            )
            for i in range(12)
        )
        self.assertTrue(
            any(
                {"2", "11"} <= {a.screen_id for a in b}
                for b in analysis_batches(artifacts)
            )
        )

    def test_all_crops_retain_clipped_dom_and_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "full.png"
            Image.new("RGB", (400, 2400)).save(path)
            original = CaptureArtifact(
                "full",
                "mobile: full page",
                "mobile",
                "https://example.com",
                "",
                path,
                400,
                2400,
                full_page=True,
                capture_height=800,
                state_id="initial",
                dom_elements=(
                    {
                        "element_id": "fee",
                        "bbox": [0.1, 0.6, 0.5, 0.2],
                        "element_type": "price",
                        "text": "해지 수수료 50,000원",
                    },
                ),
            )
            crops = prepare_analysis_artifacts((original,))
            self.assertEqual(len(crops), 3)
            self.assertEqual([len(a.dom_elements) for a in crops], [0, 1, 1])
            for a in crops:
                self.assertEqual(a.state_id, "initial")
                for e in a.dom_elements:
                    x, y, w, h = e["bbox"]
                    self.assertGreater(h, 0)
                    self.assertLessEqual(y + h, 1)
                    self.assertTrue(e["element_id"].startswith(a.screen_id + "::"))

    def test_batches_cover_every_screen_and_do_not_mix_profiles(self):
        artifacts = tuple(
            CaptureArtifact(
                f"{profile}{i}", str(i), profile, "", "", Path("x"), 400, 800
            )
            for profile in ("desktop", "mobile")
            for i in range(12)
        )
        batches = analysis_batches(artifacts)
        self.assertEqual(
            {a.screen_id for a in artifacts}, {a.screen_id for b in batches for a in b}
        )
        self.assertTrue(
            all(len(b) <= 5 and len({a.profile for a in b}) == 1 for b in batches)
        )

    def test_browser_extracts_aria_cost_text_and_document_coordinates(self):
        with sync_playwright() as manager:
            executable = shutil.which("google-chrome")
            if not executable and not Path(manager.chromium.executable_path).exists():
                self.skipTest("Install Playwright Chromium for DOM integration tests")
            browser = manager.chromium.launch(executable_path=executable, headless=True)
            page = browser.new_page(viewport={"width": 400, "height": 800})
            page.set_content("""<p style="font-size:20px">보험 상품 설명과 소비자가 확인할 수 있는 일반 안내 문구입니다.</p>
                <label><button role="checkbox" aria-checked="true">✓</button>유료 옵션 3,000원</label>
                <p style="font-size:9px;color:#aaa">중도 해지 수수료 50,000원이 발생할 수 있습니다.</p>
                <details><summary>주요 비용 자세히 보기</summary>수수료</details>
                <div style="height:1600px"></div><label><input type="checkbox" checked>하단 옵션 2,000원</label>""")
            elements = page.evaluate(_RULE_ENGINE_EXTRACT_JS, {"fullPage": True})
            screen = Screen(
                1,
                [
                    Element(
                        e["element_id"],
                        e["element_type"],
                        e["text"],
                        e["bbox"],
                        e["state"],
                        e["computed_style"],
                    )
                    for e in elements
                ],
            )
            self.assertEqual(len(da04_checked(screen, RuleBase())), 2)
            self.assertTrue(
                any(
                    "50,000" in (d.primary.text or "")
                    for d in da07_asymmetry(screen, RuleBase())
                )
            )
            self.assertTrue(any(e["element_type"] == "accordion" for e in elements))
            self.assertTrue(
                all(
                    0 <= e["bbox"][1] and e["bbox"][1] + e["bbox"][3] <= 1.000001
                    for e in elements
                )
            )
            browser.close()
