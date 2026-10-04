import tempfile
import unittest
from pathlib import Path

from ai.browser.explorer import HybridWebExplorer
from ai.browser.models import (
    BrowserAction,
    BrowserActionType,
    CaptureArtifact,
    ComputerTurn,
    ScanMode,
)
from ai.browser.profiles import get_device_profile


class FakeSession:
    def __init__(self, directory: Path, profile):
        self.directory = directory
        self.profile = profile
        self.executed = []
        self.index = 0

    def __enter__(self): return self
    def __exit__(self, *_): return None

    def start(self, url):
        self.url = url
        return self._artifact("initial viewport")

    def capture(self, flow_step, *, full_page=False, action=None):
        return self._artifact(flow_step, full_page=full_page, action=action)

    def execute(self, action): self.executed.append(action)
    def inspect_target(self, action): return {"tag": "button", "text": "자세히 보기"}

    def _artifact(self, step, *, full_page=False, action=None):
        index = self.index
        self.index += 1
        path = self.directory / f"{index}.png"
        path.write_bytes(f"image-{index}".encode())
        return CaptureArtifact(
            f"{self.profile.name}_{index:02d}", step, self.profile.name,
            self.url, "Example", path, self.profile.viewport_width,
            self.profile.viewport_height, full_page, action, fingerprint=f"hash-{index}",
        )


class FakeFactory:
    def __init__(self, directory): self.directory = Path(directory); self.session = None
    def __call__(self, audit_id, profile):
        self.session = FakeSession(self.directory, profile)
        return self.session


class FakeAgent:
    def __init__(self): self.resumes = 0
    def begin(self, goal):
        return ComputerTurn("response-1", "call-1", (BrowserAction(BrowserActionType.SCREENSHOT),))
    def resume(self, previous_turn, screenshot_path):
        self.resumes += 1
        if self.resumes == 1:
            return ComputerTurn(
                "response-2", "call-2",
                (BrowserAction(BrowserActionType.CLICK, x=100, y=100),),
            )
        return ComputerTurn("response-3", None, final_text="done")


class HybridWebExplorerTest(unittest.TestCase):
    def test_quick_mode_captures_viewport_and_full_page_without_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            factory = FakeFactory(directory)
            result = HybridWebExplorer(factory).capture(
                audit_id="audit", url="https://example.com",
                profile=get_device_profile("desktop"), mode=ScanMode.QUICK,
            )
            self.assertEqual(len(result.artifacts), 2)
            self.assertTrue(result.artifacts[-1].full_page)

    def test_smart_mode_uses_screenshot_first_computer_loop(self):
        with tempfile.TemporaryDirectory() as directory:
            factory = FakeFactory(directory)
            agent = FakeAgent()
            result = HybridWebExplorer(factory, computer_agent=agent).capture(
                audit_id="audit", url="https://example.com",
                profile=get_device_profile("mobile"), mode=ScanMode.SMART,
            )
            self.assertEqual(agent.resumes, 2)
            self.assertEqual(len(factory.session.executed), 1)
            self.assertEqual(factory.session.executed[0].type, BrowserActionType.CLICK)
            self.assertIn("completed", result.stop_reason)

    def test_completion_on_last_allowed_turn_is_not_budget_exhaustion(self):
        with tempfile.TemporaryDirectory() as directory:
            result = HybridWebExplorer(
                FakeFactory(directory), computer_agent=FakeAgent(), max_agent_turns=2,
            ).capture(
                audit_id="audit", url="https://example.com",
                profile=get_device_profile("mobile"), mode=ScanMode.SMART,
            )
            self.assertEqual(result.stop_reason, "Computer Use completed exploration")

    def test_six_step_journey_has_room_for_screenshot_and_intermediate_actions(self):
        class JourneyAgent(FakeAgent):
            def resume(self, previous_turn, screenshot_path):
                self.resumes += 1
                if self.resumes <= 8:
                    return ComputerTurn(str(self.resumes), "call", (
                        BrowserAction(BrowserActionType.CLICK, x=100, y=100),
                    ))
                return ComputerTurn("done", None)

        with tempfile.TemporaryDirectory() as directory:
            factory = FakeFactory(directory)
            result = HybridWebExplorer(factory, computer_agent=JourneyAgent()).capture(
                audit_id="audit", url="https://example.com",
                profile=get_device_profile("mobile"), mode=ScanMode.SMART,
            )
            self.assertEqual(len(factory.session.executed), 8)
            self.assertEqual(result.stop_reason, "Computer Use completed exploration")


if __name__ == "__main__":
    unittest.main()
