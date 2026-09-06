"""
DarkAudit API 계약
-----------------
기존 엔드포인트와 필드는 유지하고, 합의된 필드를 optional 로 추가한다.

호환성 원칙

    필드 추가는 안전하지만 **enum 값 추가는 안전하지 않다.**
    프론트에 TypeScript 타입과 Zod enum 검증이 따로 있으므로, 백엔드가
    `LOW` 나 새 ruleId 를 내보내는 순간 프론트 검증이 실패한다.

    따라서 새 enum 값은 프론트 타입이 함께 배포될 때까지 응답에서 막는다.
    막는 위치는 compat.py 이며, 스키마 자체는 최종 형태로 정의해 둔다.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

RuleId = Literal["DA-02", "DA-03", "DA-04", "DA-05", "DA-07", "DA-11", "DA-12", "DA-13", "DA-15"]
RiskType = Literal[
    "DECEPTIVE_QUESTION",
    "VISUAL_HIERARCHY_DISTORTION",
    "PRESELECTED_OPTION",
    "FALSE_ADVERTISING",
    "HIDDEN_INFORMATION",
    "REPEATED_INTERFERENCE",
    "EMOTIONAL_LANGUAGE",
    "SENSORY_MANIPULATION",
    "SEQUENTIAL_PRICE_DISCLOSURE",
]
Severity = Literal["HIGH", "REVIEW", "LOW"]
FindingStatus = Literal["open", "reviewing", "resolved"]


class CreateAuditRequest(BaseModel):
    name: str = Field(min_length=1)
    platform: Literal["mobile-web", "desktop-web", "app"]


class ScreenDto(BaseModel):
    id: str
    order: int
    flowStep: str
    imageUrl: str
    findingCount: int = 0
    # 정규화 좌표를 원본 이미지 기준으로 되돌리는 데 필요하다
    width: int | None = None
    height: int | None = None


class BBox(BaseModel):
    """
    요소 위치.

    coordinateSystem 을 명시한다. 내부 계산은 정규화(0~1)로 하지만
    프론트는 원본 이미지 위에 그리므로 어느 기준인지 알아야 한다.
    """
    screenId: str
    x: float
    y: float
    width: float
    height: float
    coordinateSystem: Literal["image", "normalized"] = "image"


class ElementRef(BaseModel):
    """관계를 구성하는 요소. primary 와 related 가 같은 형태를 쓴다."""
    screenId: str
    description: str
    bbox: BBox | None = None
    elementType: str | None = None


class FindingDto(BaseModel):
    id: str
    ruleId: RuleId
    riskType: RiskType
    title: str
    description: str
    screenIds: list[str]
    element: str
    defaultState: str | None = None
    costImpact: str | None = None
    severity: Severity
    status: FindingStatus = "open"
    confidence: float = Field(ge=0, le=1)
    recommendation: str
    guideline: str

    # --- 확장 필드. 전부 optional 또는 기본값이라 기존 응답과 호환된다 ---

    # 관찰 사실. 기존 description(what + why)은 유지하고 별도 필드로 둔다.
    # Evidence 6요소 중 OBSERVATION 이 description 에 뭉개져 사라지던 문제를 푼다.
    observation: str | None = None

    # 대표 요소의 위치. Localization 평가와 프론트 하이라이트에 쓴다.
    bbox: BBox | None = None

    # 관계 요소. DA-02 · DA-03 · DA-11 은 이것이 비면 불완전한 탐지다.
    relatedElements: list[ElementRef] = Field(default_factory=list)

    # 완화 요건 충족 여부. 유형은 유지하고 severity 만 1단계 하향된 상태.
    mitigated: bool = False

    # 결합 판정으로 severity 가 승격된 경우의 근거.
    #   combinationWith    같은 Run 안의 연관 findingId (프론트 이동용)
    #   combinationRules   근거가 된 rule_id (정답 라벨과 대조하는 평가용)
    # 둘을 함께 두는 이유: 정답 라벨에는 findingId 가 없어 rule_id 단위 비교가 필요하다.
    combinationWith: list[str] = Field(default_factory=list)
    combinationRules: list[str] = Field(default_factory=list)

    # 어느 deterministic check 가 걸렸는지. 재현과 디버깅용.
    triggeredChecks: list[str] = Field(default_factory=list)
    measurements: dict | None = None


class AuditRunDto(BaseModel):
    """감사 회차. Before/After 비교의 단위."""
    id: str
    version: int
    status: Literal["queued", "analyzing", "completed", "failed"]
    note: str | None = None
    createdAt: datetime
    findingCount: int = 0


class AuditDto(BaseModel):
    id: str
    name: str
    platform: Literal["mobile-web", "desktop-web", "app"]
    status: Literal["draft", "queued", "analyzing", "completed", "failed"]
    updatedAt: datetime
    screens: list[ScreenDto]

    # 최신 완료 Run 의 결과를 그대로 노출한다.
    # 내부가 AuditRun 으로 바뀌어도 프론트는 기존과 동일하게 동작한다.
    findings: list[FindingDto]

    # 회차 목록. 프론트가 아직 쓰지 않아도 무해하다.
    runs: list[AuditRunDto] = Field(default_factory=list)
    latestRunId: str | None = None
    analysisSummary: dict = Field(default_factory=dict)


class JobDto(BaseModel):
    jobId: str
    auditId: str
    status: Literal["queued", "analyzing", "completed", "failed"]
    progress: float = Field(ge=0, le=100)
    runId: str | None = None
    error: str | None = None


class ImportFigmaRequest(BaseModel):
    fileUrl: HttpUrl
    target: Literal["mobile-web", "desktop-web", "app"]
    selectionMode: Literal["prototype-flow", "all-frames"]
    flowName: str | None = Field(default=None, max_length=200)


class CaptureAuditRequest(BaseModel):
    url: HttpUrl
    mode: Literal["quick", "smart"] = "quick"
    profiles: list[Literal["desktop", "mobile"]] = Field(
        default_factory=lambda: ["desktop", "mobile"], min_length=1, max_length=2
    )
    goal: str | None = Field(default=None, max_length=1000)


class DashboardSummaryDto(BaseModel):
    activeAuditId: str | None
    audits: list[AuditDto]


class FindingStatusRequest(BaseModel):
    status: FindingStatus


class RegressionChangeDto(BaseModel):
    ruleId: str
    findingId: str | None = None
    before: Severity | None = None
    after: Severity | None = None


class RegressionDto(BaseModel):
    auditId: str
    fromVersion: int
    toVersion: int
    resolved: list[RegressionChangeDto] = Field(default_factory=list)
    improved: list[RegressionChangeDto] = Field(default_factory=list)
    persisted: list[RegressionChangeDto] = Field(default_factory=list)
    new: list[RegressionChangeDto] = Field(default_factory=list)
    regressed: list[RegressionChangeDto] = Field(default_factory=list)
    resolvedRatio: float = 0.0
