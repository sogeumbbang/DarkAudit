"""Strict request/response contract for the multimodal MVP baseline."""

from dataclasses import asdict, dataclass, field
from enum import Enum
import math
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "1.2"
DEVICE_PROFILES = frozenset({"desktop", "mobile", "iphone"})


class RiskType(str, Enum):
    PRESELECTED_OPTION = "PRESELECTED_OPTION"
    VISUAL_HIERARCHY_DISTORTION = "VISUAL_HIERARCHY_DISTORTION"
    HIDDEN_INFORMATION = "HIDDEN_INFORMATION"
    EMOTIONAL_LANGUAGE = "EMOTIONAL_LANGUAGE"
    SEQUENTIAL_PRICE_DISCLOSURE = "SEQUENTIAL_PRICE_DISCLOSURE"


class Severity(str, Enum):
    REVIEW = "REVIEW"
    HIGH = "HIGH"


class CandidateDecisionValue(str, Enum):
    KEEP = "KEEP"
    REJECT = "REJECT"


RISK_RULE_MAP = {
    RiskType.PRESELECTED_OPTION: "DA-04",
    RiskType.VISUAL_HIERARCHY_DISTORTION: "DA-03",
    RiskType.HIDDEN_INFORMATION: "DA-07",
    RiskType.EMOTIONAL_LANGUAGE: "DA-12",
    RiskType.SEQUENTIAL_PRICE_DISCLOSURE: "DA-15",
}
RISK_NAME_MAP = {
    RiskType.PRESELECTED_OPTION: "특정옵션의 사전선택",
    RiskType.VISUAL_HIERARCHY_DISTORTION: "잘못된 계층구조",
    RiskType.HIDDEN_INFORMATION: "숨겨진 정보",
    RiskType.EMOTIONAL_LANGUAGE: "감정적 언어",
    RiskType.SEQUENTIAL_PRICE_DISCLOSURE: "순차공개 가격책정",
}

# ``severity`` is the Rule Base severity before downstream combination or
# mitigation scoring. It is intentionally not the final severity.
BASE_SEVERITY_MAP = {
    RiskType.PRESELECTED_OPTION: Severity.HIGH,
    RiskType.VISUAL_HIERARCHY_DISTORTION: Severity.HIGH,
    RiskType.HIDDEN_INFORMATION: Severity.HIGH,
    RiskType.EMOTIONAL_LANGUAGE: Severity.REVIEW,
    RiskType.SEQUENTIAL_PRICE_DISCLOSURE: Severity.HIGH,
}

RULE_BASE_SEVERITY = {
    "DA-03": Severity.HIGH,
    "DA-04": Severity.HIGH,
    "DA-07": Severity.HIGH,
    "DA-12": Severity.REVIEW,
    "DA-15": Severity.HIGH,
}

# New findings may only originate from these explicitly agreed semantic-only
# checks. Detection stays unchanged, so the Rule-level allow-list is derived
# from this policy instead of being maintained separately.
SEMANTIC_ONLY_CHECKS_BY_RULE = {
    "DA-03": frozenset({"DA-03.optional_looks_mandatory"}),
    "DA-12": frozenset({
        "DA-12.loss_framed_decline",
        "DA-12.trivializing_expression",
    }),
}
SEMANTIC_ONLY_RULE_IDS = frozenset(SEMANTIC_ONLY_CHECKS_BY_RULE)
VISUAL_FALLBACK_RULE_IDS = frozenset(RULE_BASE_SEVERITY)

INTERACTION_REQUIRED_CHECKS = frozenset({"DA-07.skippable_without_confirm"})
INTERACTION_EVIDENCE_KEY = "interaction_evidence"

NormalizedBBox = tuple[float, float, float, float]


def _normalized_bbox(value: Any, field_name: str = "bbox") -> NormalizedBBox:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError(f"{field_name} must be [x, y, width, height]")
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
        raise ValueError(f"{field_name} values must be numbers")
    bbox = tuple(float(item) for item in value)
    if any(not math.isfinite(item) or not 0 <= item <= 1 for item in bbox):
        raise ValueError(f"{field_name} values must be finite and between 0 and 1")
    x, y, width, height = bbox
    if width <= 0 or height <= 0 or x + width > 1 + 1e-9 or y + height > 1 + 1e-9:
        raise ValueError(f"{field_name} must be a positive rectangle inside the screen")
    return bbox  # type: ignore[return-value]


def _device_profile(flow_step: str) -> str:
    prefix, separator, _ = flow_step.partition(":")
    candidate = prefix.strip().lower()
    return candidate if separator and candidate in DEVICE_PROFILES else "unspecified"


@dataclass(frozen=True, slots=True)
class AuditScreen:
    screen_id: str
    flow_step: str
    image_path: Path
    profile: str = "unspecified"
    path_id: str = "main"
    state_id: str = ""
    evidence: tuple[dict[str, Any], ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "image_path", Path(self.image_path))
        if not self.screen_id.strip() or not self.flow_step.strip():
            raise ValueError("screen_id and flow_step are required")
        if not self.image_path.is_file():
            raise FileNotFoundError(self.image_path)


@dataclass(frozen=True, slots=True)
class LLMAuditRequest:
    audit_id: str
    screens: tuple[AuditScreen, ...]
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if not self.audit_id.strip() or not 1 <= len(self.screens) <= 5:
            raise ValueError("audit_id and 1 to 5 screens are required")
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
        ids = [screen.screen_id for screen in self.screens]
        if len(ids) != len(set(ids)):
            raise ValueError("screen_id values must be unique")


@dataclass(frozen=True, slots=True)
class RuleCandidate:
    candidate_id: str
    rule_id: str
    screen_id: str
    screen_index: int
    primary_element_id: str | None
    triggered_checks: tuple[str, ...]
    measurements: dict[str, Any]
    related_element_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.candidate_id.strip() or not self.screen_id.strip():
            raise ValueError("candidate_id and screen_id are required")
        if self.rule_id not in RULE_BASE_SEVERITY:
            raise ValueError(f"unsupported candidate rule_id: {self.rule_id}")
        if isinstance(self.screen_index, bool) or not isinstance(self.screen_index, int) or self.screen_index < 1:
            raise ValueError("screen_index must be a positive integer")
        if self.primary_element_id is not None and not self.primary_element_id.strip():
            raise ValueError("primary_element_id must be non-empty or null")
        if not self.triggered_checks or any(not item.strip() for item in self.triggered_checks):
            raise ValueError("triggered_checks must contain non-empty check ids")
        if len(self.triggered_checks) != len(set(self.triggered_checks)):
            raise ValueError("triggered_checks must be unique")
        if not isinstance(self.measurements, dict):
            raise ValueError("measurements must be an object")
        if any(not item.strip() for item in self.related_element_ids):
            raise ValueError("related_element_ids must be non-empty")
        if len(self.related_element_ids) != len(set(self.related_element_ids)):
            raise ValueError("related_element_ids must be unique")

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "RuleCandidate":
        fields = {"candidate_id", "rule_id", "screen_id", "screen_index", "primary_element_id",
                  "triggered_checks", "measurements", "related_element_ids"}
        if not isinstance(value, dict) or set(value) != fields:
            raise ValueError("invalid RuleCandidate fields")
        if not isinstance(value["triggered_checks"], list) or not isinstance(value["measurements"], dict):
            raise ValueError("invalid RuleCandidate checks or measurements")
        if not isinstance(value["related_element_ids"], list):
            raise ValueError("related_element_ids must be an array")
        return cls(
            value["candidate_id"], value["rule_id"], value["screen_id"], value["screen_index"],
            value["primary_element_id"], tuple(value["triggered_checks"]),
            dict(value["measurements"]), tuple(value["related_element_ids"]),
        )


@dataclass(frozen=True, slots=True)
class CandidateDecision:
    candidate_id: str
    decision: CandidateDecisionValue
    reason: str
    confidence: float
    base_severity: Severity

    def __post_init__(self) -> None:
        if not self.candidate_id.strip() or not self.reason.strip():
            raise ValueError("candidate_id and decision reason are required")
        if not isinstance(self.decision, CandidateDecisionValue):
            raise ValueError("decision must be KEEP or REJECT")
        if not isinstance(self.base_severity, Severity):
            raise ValueError("base_severity must be a Severity")
        if isinstance(self.confidence, bool) or not isinstance(self.confidence, (int, float)) or not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be between 0 and 1")

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "CandidateDecision":
        fields = {"candidate_id", "decision", "reason", "confidence", "base_severity"}
        if not isinstance(value, dict) or set(value) != fields:
            raise ValueError("invalid CandidateDecision fields")
        return cls(
            value["candidate_id"], CandidateDecisionValue(value["decision"]), value["reason"],
            float(value["confidence"]), Severity(value["base_severity"]),
        )


@dataclass(frozen=True, slots=True)
class ScreenReference:
    screen_id: str
    flow_step: str

    def __post_init__(self) -> None:
        if not self.screen_id.strip() or not self.flow_step.strip():
            raise ValueError("screen reference fields are required")

    @property
    def device_profile(self) -> str:
        return _device_profile(self.flow_step)


@dataclass(frozen=True, slots=True)
class DetectionLocation:
    screen_ids: tuple[str, ...]
    element: str
    location: str

    def __post_init__(self) -> None:
        if not self.screen_ids or not self.element.strip() or not self.location.strip():
            raise ValueError("where fields are required")
        if len(self.screen_ids) != len(set(self.screen_ids)):
            raise ValueError("where.screen_ids must be unique")


@dataclass(frozen=True, slots=True)
class RelatedElement:
    screen_id: str
    element: str
    bbox: NormalizedBBox

    def __post_init__(self) -> None:
        if not self.screen_id.strip() or not self.element.strip():
            raise ValueError("related element fields are required")
        object.__setattr__(self, "bbox", _normalized_bbox(self.bbox, "related_elements[].bbox"))

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "RelatedElement":
        if not isinstance(value, dict) or set(value) != {"screen_id", "element", "bbox"}:
            raise ValueError("invalid related element fields")
        return cls(value["screen_id"], value["element"], value["bbox"])


@dataclass(frozen=True, slots=True)
class Detection:
    risk_type: RiskType
    risk_name: str
    where: DetectionLocation
    bbox: NormalizedBBox
    related_elements: tuple[RelatedElement, ...]
    what: str
    observation: str
    rule_id: str
    why: str
    severity: Severity
    confidence: float
    fix: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "bbox", _normalized_bbox(self.bbox))
        if not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be between 0 and 1")
        if self.rule_id != RISK_RULE_MAP[self.risk_type] or self.risk_name != RISK_NAME_MAP[self.risk_type]:
            raise ValueError("invalid risk mapping")
        if self.severity is not BASE_SEVERITY_MAP[self.risk_type]:
            raise ValueError("severity must equal the Rule Base base_severity")
        if any(not getattr(self, name).strip() for name in ("what", "observation", "why", "fix")):
            raise ValueError("narrative fields are required")

        if self.risk_type is not RiskType.SEQUENTIAL_PRICE_DISCLOSURE and len(self.where.screen_ids) != 1:
            raise ValueError(f"{self.rule_id} requires exactly one screen")
        if self.risk_type is RiskType.SEQUENTIAL_PRICE_DISCLOSURE and len(self.where.screen_ids) < 2:
            raise ValueError("DA-15 requires at least two distinct screens")

        if any(item.screen_id not in self.where.screen_ids for item in self.related_elements):
            raise ValueError("related elements must reference evidence screens in where.screen_ids")
        if self.risk_type is RiskType.VISUAL_HIERARCHY_DISTORTION:
            if not self.related_elements:
                raise ValueError("DA-03 requires a related counterpart element")
            primary_screen = self.where.screen_ids[0]
            if any(item.screen_id != primary_screen for item in self.related_elements):
                raise ValueError("DA-03 related elements must be on the primary screen")
            if any(item.element == self.where.element and item.bbox == self.bbox for item in self.related_elements):
                raise ValueError("DA-03 primary and related elements must be distinct")

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Detection":
        fields = {
            "risk_type", "risk_name", "where", "bbox", "related_elements", "what",
            "observation", "rule_id", "why", "severity", "confidence", "fix",
        }
        if not isinstance(value, dict) or set(value) != fields:
            raise ValueError("invalid detection fields")
        where = value["where"]
        if not isinstance(where, dict) or set(where) != {"screen_ids", "element", "location"}:
            raise ValueError("invalid where fields")
        related = value["related_elements"]
        if not isinstance(related, list):
            raise ValueError("related_elements must be an array")
        return cls(
            risk_type=RiskType(value["risk_type"]),
            risk_name=value["risk_name"],
            where=DetectionLocation(tuple(where["screen_ids"]), where["element"], where["location"]),
            bbox=value["bbox"],
            related_elements=tuple(RelatedElement.from_dict(item) for item in related),
            what=value["what"],
            observation=value["observation"],
            rule_id=value["rule_id"],
            why=value["why"],
            severity=Severity(value["severity"]),
            confidence=float(value["confidence"]),
            fix=value["fix"],
        )


@dataclass(frozen=True, slots=True)
class LLMAuditOutput:
    audit_id: str
    schema_version: str
    screens: tuple[ScreenReference, ...]
    detections: tuple[Detection, ...]

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "LLMAuditOutput":
        if not isinstance(value, dict) or set(value) != {"audit_id", "schema_version", "screens", "detections"}:
            raise ValueError("invalid output fields")
        if value["schema_version"] != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
        screens = tuple(ScreenReference(**screen) for screen in value["screens"])
        output = cls(
            value["audit_id"],
            value["schema_version"],
            screens,
            tuple(Detection.from_dict(item) for item in value["detections"]),
        )
        screen_map = {screen.screen_id: screen for screen in screens}
        if len(screen_map) != len(screens):
            raise ValueError("screen_id values must be unique")
        referenced_ids = (
            screen_id
            for finding in output.detections
            for screen_id in (*finding.where.screen_ids, *(item.screen_id for item in finding.related_elements))
        )
        if any(screen_id not in screen_map for screen_id in referenced_ids):
            raise ValueError("unknown screen_id reference")

        for finding in output.detections:
            if finding.risk_type is RiskType.SEQUENTIAL_PRICE_DISCLOSURE:
                profiles = {screen_map[screen_id].device_profile for screen_id in finding.where.screen_ids}
                if len(profiles) != 1:
                    raise ValueError("DA-15 evidence screens must use the same device profile")

        # One element may legitimately receive multiple labels, but the same Rule
        # must not be emitted twice for the same primary element.
        detection_keys = [
            (finding.rule_id, finding.where.screen_ids[-1], finding.bbox)
            for finding in output.detections
        ]
        if len(detection_keys) != len(set(detection_keys)):
            raise ValueError("duplicate Rule detection for the same element")
        return output

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class HybridAuditOutput:
    audit_id: str
    schema_version: str
    screens: tuple[ScreenReference, ...]
    candidate_decisions: tuple[CandidateDecision, ...]
    semantic_findings: tuple[Detection, ...]
    candidates: tuple[RuleCandidate, ...] = field(repr=False, compare=False)
    allowed_semantic_rule_ids: frozenset[str] = field(
        default=SEMANTIC_ONLY_RULE_IDS, repr=False, compare=False
    )

    rule_assessments: tuple[dict[str, Any], ...] = ()

    def __post_init__(self) -> None:
        if not self.audit_id.strip() or self.schema_version != SCHEMA_VERSION:
            raise ValueError("invalid hybrid audit identity")
        screen_ids = [screen.screen_id for screen in self.screens]
        if not screen_ids or len(screen_ids) != len(set(screen_ids)):
            raise ValueError("screen_id values must be present and unique")

        candidate_ids = [candidate.candidate_id for candidate in self.candidates]
        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("candidate_id values must be unique")
        if any(candidate.screen_id not in screen_ids for candidate in self.candidates):
            raise ValueError("candidate references an unknown screen_id")

        decision_ids = [decision.candidate_id for decision in self.candidate_decisions]
        if len(decision_ids) != len(set(decision_ids)):
            raise ValueError("duplicate candidate decision")
        unknown = sorted(set(decision_ids) - set(candidate_ids))
        if unknown:
            raise ValueError(f"unknown candidate_id decisions: {', '.join(unknown)}")
        missing = sorted(set(candidate_ids) - set(decision_ids))
        if missing:
            raise ValueError(f"missing candidate decisions: {', '.join(missing)}")

        candidate_by_id = {candidate.candidate_id: candidate for candidate in self.candidates}
        for decision in self.candidate_decisions:
            candidate = candidate_by_id[decision.candidate_id]
            rule_id = candidate.rule_id
            if decision.base_severity is not RULE_BASE_SEVERITY[rule_id]:
                raise ValueError(f"base_severity does not match Rule Base for {rule_id}")
            requires_interaction = INTERACTION_REQUIRED_CHECKS.intersection(candidate.triggered_checks)
            has_interaction_evidence = candidate.measurements.get(INTERACTION_EVIDENCE_KEY) is True
            if (
                decision.decision is CandidateDecisionValue.KEEP
                and requires_interaction
                and not has_interaction_evidence
            ):
                raise ValueError(
                    "DA-07.skippable_without_confirm requires interaction_evidence=true to KEEP"
                )
        if any(finding.rule_id not in self.allowed_semantic_rule_ids for finding in self.semantic_findings):
            raise ValueError(
                "semantic_findings may only contain semantic-only rules or visual rules "
                "enabled for this audit source"
            )
        # Reuse the established detection-level screen, profile, and duplicate
        # validation for semantic-only findings.
        LLMAuditOutput(
            self.audit_id, self.schema_version, self.screens, self.semantic_findings
        ).to_dict()

    @classmethod
    def from_dict(
        cls,
        value: dict[str, Any],
        candidates: list[RuleCandidate] | tuple[RuleCandidate, ...],
        allowed_semantic_rule_ids: frozenset[str] = SEMANTIC_ONLY_RULE_IDS,
    ) -> "HybridAuditOutput":
        fields = {"audit_id", "schema_version", "screens", "candidate_decisions", "semantic_findings"}
        if not isinstance(value, dict) or set(value) not in (fields, fields | {"rule_assessments"}):
            raise ValueError("invalid HybridAuditOutput fields")
        if not isinstance(value["candidate_decisions"], list) or not isinstance(value["semantic_findings"], list):
            raise ValueError("hybrid output collections must be arrays")
        return cls(
            audit_id=value["audit_id"],
            schema_version=value["schema_version"],
            screens=tuple(ScreenReference(**screen) for screen in value["screens"]),
            candidate_decisions=tuple(CandidateDecision.from_dict(item) for item in value["candidate_decisions"]),
            semantic_findings=tuple(Detection.from_dict(item) for item in value["semantic_findings"]),
            candidates=tuple(candidates),
            allowed_semantic_rule_ids=allowed_semantic_rule_ids,
            rule_assessments=tuple(value.get("rule_assessments", [])),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "audit_id": self.audit_id,
            "schema_version": self.schema_version,
            "screens": [asdict(screen) for screen in self.screens],
            "candidate_decisions": [asdict(decision) for decision in self.candidate_decisions],
            "semantic_findings": [asdict(finding) for finding in self.semantic_findings],
            **({"rule_assessments":list(self.rule_assessments)} if self.rule_assessments else {}),
        }

    @property
    def detections(self) -> tuple[Detection, ...]:
        """Temporary internal compatibility alias until backend hybrid merge lands."""
        return self.semantic_findings
