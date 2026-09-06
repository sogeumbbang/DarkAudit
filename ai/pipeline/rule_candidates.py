"""Shared DOM-to-candidate contract for HTTP and CLI URL audits."""

from collections import defaultdict

from ai.browser.models import CaptureArtifact
from backend.app.rule_engine import checks as _checks  # noqa: F401 — register checks
from backend.app.rule_engine.core import Element, Flow, RuleBase, Screen, run
from backend.app.rule_engine.severity import drop_incomplete, merge, score

MVP_RULE_IDS = frozenset({"DA-03", "DA-04", "DA-07", "DA-12", "DA-15"})


def run_artifact_rules(
    audit_id: str, indices: list[int], artifacts: tuple[CaptureArtifact, ...]
):
    groups = defaultdict(list)
    for index, artifact in zip(indices, artifacts, strict=True):
        screen = Screen(
            index,
            [
                Element(
                    e["element_id"],
                    e["element_type"],
                    e.get("text"),
                    e["bbox"],
                    e.get("state") or {},
                    e.get("computed_style") or {},
                )
                for e in artifact.dom_elements
            ],
            state_id=artifact.state_id or artifact.screen_id,
        )
        groups[(artifact.profile, artifact.path_id)].append(screen)
    rules = RuleBase()
    findings = []
    for (profile, path_id), screens in groups.items():
        findings.extend(
            score(
                drop_incomplete(
                    merge(
                        run(
                            Flow(
                                f"{audit_id}:{profile}:{path_id}", "join", None, screens
                            ),
                            rules,
                            only=MVP_RULE_IDS,
                        ),
                        rules,
                    ),
                    rules,
                ),
                rules,
            )
        )
    return findings


def candidate_payload(
    findings, indices: list[int], artifacts: tuple[CaptureArtifact, ...]
):
    screens = dict(zip(indices, artifacts, strict=True))
    elements = {e["element_id"]: (a, e) for a in artifacts for e in a.dom_elements}
    payload = []
    for finding in findings:
        evidence_indices = (
            [finding.screen_index]
            if finding.screen_index is not None
            else list(finding.screen_indices)
        )
        if not evidence_indices or evidence_indices[-1] not in screens:
            raise ValueError(f"Rule candidate {finding.rule_id} has no captured screen")
        index = evidence_indices[-1]
        artifact = screens[index]
        evidence = []
        for element_id in [finding.primary_id, *finding.related_ids]:
            if element_id in elements:
                source, element = elements[element_id]
                evidence.append(
                    {
                        "screen_id": source.screen_id,
                        "state_id": source.state_id,
                        "element_id": element_id,
                        "text": element.get("text"),
                        "bbox": element["bbox"],
                        "state": element.get("state") or {},
                    }
                )
        payload.append(
            {
                "candidate_id": f"{finding.rule_id}:{artifact.screen_id}:{finding.primary_id or 'flow'}",
                "rule_id": finding.rule_id,
                "screen_id": artifact.screen_id,
                "screen_index": index,
                "primary_element_id": finding.primary_id,
                "related_element_ids": list(finding.related_ids),
                "triggered_checks": [
                    c
                    if c.startswith(f"{finding.rule_id}.")
                    else f"{finding.rule_id}.{c}"
                    for c in finding.triggered_checks
                ],
                "measurements": {**finding.measurements, "evidence": evidence},
            }
        )
    ids = [p["candidate_id"] for p in payload]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate generated candidate_id")
    return payload
