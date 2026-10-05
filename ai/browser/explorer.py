"""Hybrid deterministic/visual browser exploration orchestration."""

from __future__ import annotations

from collections.abc import Callable

from .base import BrowserSessionFactory, ComputerAgent
from .models import BrowserActionType, CaptureArtifact, CaptureResult, ExplorationEvent, ScanMode
from .profiles import DeviceProfile
from .safety import ActionSafetyPolicy, UnsafeActionError, UnsafeUrlError


class HybridWebExplorer:
    def __init__(
        self,
        session_factory: BrowserSessionFactory,
        *,
        computer_agent: ComputerAgent | None = None,
        action_policy: ActionSafetyPolicy | None = None,
        max_agent_turns: int = 12,
        on_event: Callable[[ExplorationEvent], None] | None = None,
    ) -> None:
        if max_agent_turns < 1:
            raise ValueError("max_agent_turns must be at least 1")
        self.session_factory = session_factory
        self.computer_agent = computer_agent
        self.action_policy = action_policy or ActionSafetyPolicy()
        self.max_agent_turns = max_agent_turns
        self.on_event = on_event

    def _emit(self, event: ExplorationEvent) -> None:
        if self.on_event is not None:
            self.on_event(event)

    def capture(
        self,
        *,
        audit_id: str,
        url: str,
        profile: DeviceProfile,
        mode: ScanMode = ScanMode.QUICK,
        goal: str | None = None,
    ) -> CaptureResult:
        artifacts: list[CaptureArtifact] = []
        stop_reason = "quick capture completed"

        with self.session_factory(audit_id, profile) as session:
            initial = session.start(url)
            self._append_unique(artifacts, initial)
            self._emit(ExplorationEvent("capture", initial))

            if mode is ScanMode.QUICK:
                full_page = session.capture("full page", full_page=True)
                self._append_unique(artifacts, full_page)
                self._emit(ExplorationEvent("capture", full_page))
                self._emit(ExplorationEvent("complete", full_page, reason=stop_reason))
                return CaptureResult(audit_id, profile.name, mode, tuple(artifacts), stop_reason)

            if self.computer_agent is None:
                raise ValueError("smart mode requires a Computer Use agent")

            audit_goal = goal or (
                "Inspect the main customer journey for deceptive choice architecture, preselected "
                "options, visual hierarchy distortion, emotional pressure, and delayed price disclosure."
            )
            turn = self.computer_agent.begin(audit_goal)
            current = initial
            stop_reason = "agent turn budget exhausted"

            for turn_index in range(1, self.max_agent_turns + 1):
                if turn.pending_safety_checks:
                    stop_reason = "Computer Use requested a safety confirmation"
                    break
                if turn.is_finished:
                    stop_reason = "Computer Use completed exploration"
                    break

                actionable = [
                    action for action in turn.actions if action.type is not BrowserActionType.SCREENSHOT
                ]
                try:
                    for action_index, action in enumerate(actionable, 1):
                        target = session.inspect_target(action) if action.type is BrowserActionType.CLICK else None
                        self.action_policy.validate(
                            action,
                            viewport_width=profile.viewport_width,
                            viewport_height=profile.viewport_height,
                            target=target,
                        )
                        # Coordinates refer to the screen BEFORE the action.
                        self._emit(ExplorationEvent("action", current, action))
                        session.execute(action)
                        current = session.capture(
                            f"agent step {turn_index}.{action_index}", action=action,
                        )
                        self._append_unique(artifacts, current)
                        self._emit(ExplorationEvent("result", current))
                except (UnsafeActionError, UnsafeUrlError) as exc:
                    stop_reason = f"safety policy stopped exploration: {exc}"
                    break

                turn = self.computer_agent.resume(turn, current.image_path)
                # A completion returned on the final allowed turn is still a
                # completed exploration, not an exhausted budget.
                if turn.is_finished:
                    stop_reason = "Computer Use completed exploration"
                    break

            try:
                final_page = session.capture("final full page", full_page=True)
                self._append_unique(artifacts, final_page)
                self._emit(ExplorationEvent("capture", final_page))
            except UnsafeUrlError as exc:
                stop_reason = f"safety policy stopped exploration: {exc}"

            kind = "complete" if stop_reason == "Computer Use completed exploration" else "stopped"
            self._emit(ExplorationEvent(kind, current, reason=stop_reason))

        return CaptureResult(audit_id, profile.name, mode, tuple(artifacts), stop_reason)

    @staticmethod
    def _append_unique(artifacts: list[CaptureArtifact], candidate: CaptureArtifact) -> None:
        if candidate.full_page or all(item.fingerprint != candidate.fingerprint for item in artifacts):
            artifacts.append(candidate)
