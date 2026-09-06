import unittest
import tempfile
from pathlib import Path

from PIL import Image

from ai.browser.models import CaptureArtifact
from ai.pipeline.web_audit import select_analysis_artifacts


def artifact(index: int) -> CaptureArtifact:
    return CaptureArtifact(
        f"screen_{index}", f"step {index}", "desktop", "https://example.com", "Example",
        Path(f"screen-{index}.png"), 1440, 900, fingerprint=f"hash-{index}",
    )


class WebAuditSelectionTest(unittest.TestCase):
    def test_evenly_selects_first_middle_and_last_states(self):
        selected = select_analysis_artifacts(tuple(artifact(index) for index in range(9)), 5)
        self.assertEqual([item.screen_id for item in selected], [
            "screen_0", "screen_2", "screen_4", "screen_6", "screen_8",
        ])

    def test_splits_tall_full_page_and_excludes_long_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "full.png"
            image = Image.new("RGB", (390, 3200), "white")
            image.save(path)
            full_page = CaptureArtifact(
                "mobile_full",
                "mobile: full page",
                "mobile",
                "https://example.com",
                "Example",
                path,
                390,
                844,
                full_page=True,
                fingerprint="full",
            )

            selected = select_analysis_artifacts((artifact(0), full_page), 5)

            self.assertEqual(len(selected), 5)
            self.assertEqual(selected[0].screen_id, "screen_0")
            self.assertNotIn("mobile_full", [item.screen_id for item in selected])
            self.assertEqual(
                [item.viewport_height for item in selected[1:]],
                [800, 800, 800, 800],
            )
            self.assertTrue(all(item.image_path.is_file() for item in selected[1:]))


if __name__ == "__main__":
    unittest.main()
