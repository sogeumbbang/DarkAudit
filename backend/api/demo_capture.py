"""Stable first-entry screens for the authored six-step website demo.

Computer Use still performs the navigation and records every action. Comparison
uses the first captured viewport of each authored step, so extra clicks, waits
and revisits do not change the comparison's screen identities.
"""
from dataclasses import replace
from urllib.parse import parse_qs, urlsplit

from ai.browser.models import CaptureArtifact


def demo_entry_screens(
    artifacts: tuple[CaptureArtifact, ...], seed_url: str,
    preset: dict | None, variant: str | None,
) -> tuple[CaptureArtifact, ...] | None:
    if not preset or preset.get("source") != "website" or variant not in {"risky", "partial", "revised"}:
        return None
    seed = urlsplit(seed_url)
    if seed.path not in {"/demo/web/index.html", "/dark-pattern-demo/index.html"}:
        return None
    query = parse_qs(seed.query)
    if query.get("scenario") != [preset.get("scenario")] or query.get("variant") != [variant]:
        return None
    by_profile: dict[str, dict[int, CaptureArtifact]] = {}
    for artifact in artifacts:
        page = urlsplit(artifact.url)
        params = parse_qs(page.query)
        if (page.scheme, page.netloc, page.path) != (seed.scheme, seed.netloc, seed.path):
            return None
        if params.get("scenario") != query["scenario"] or params.get("variant") != [variant]:
            return None
        step_values = params.get("step", ["1"])
        if len(step_values) != 1 or step_values[0] not in {str(i) for i in range(1, 7)}:
            return None
        steps = by_profile.setdefault(artifact.profile, {})
        if not artifact.full_page:
            steps.setdefault(int(step_values[0]), artifact)
    if not by_profile or any(set(steps) != set(range(1, 7)) for steps in by_profile.values()):
        return None
    return tuple(
        replace(steps[step], screen_id=f"{profile}_demo_{step:02d}",
                flow_step=f"{profile}: 데모 {preset['scenario']} · {step}단계",
                state_id=f"demo-step-{step}", path_id=f"demo-{preset['scenario']}")
        for profile, steps in by_profile.items() for step in range(1, 7)
    )
