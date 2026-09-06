"""
DarkAudit 데이터 모델
--------------------

구조

    Audit                감사 세션 (하나의 금융상품 Flow 에 대한 검사 전체)
     └ AuditRun          회차 (v1 = 최초, v2 = 수정 후 ...)
        ├ Screen         화면 (순서, flow_type)
        │  └ Element     UI 요소 — 전부 저장한다
        └ Finding        탐지된 위험
           └ Evidence    WHERE / WHAT / OBSERVATION / RULE / WHY / FIX

핵심 설계 결정

1) AuditRun 을 Audit 과 분리한다
   화면을 Audit 에 직접 매달면 v1 과 v2 를 구분할 수 없어 Before/After 비교
   로직이 지저분해진다. 회차를 분리하면 같은 Audit 안의 두 Run 을 조인 한 번으로
   비교할 수 있다.

2) Element 를 전부 저장한다
   Finding 에 걸린 요소만 남기면 용량은 작지만, 탐지 임계값을 바꿀 때마다
   화면을 다시 올려야 한다. 개발 기간 중 임계값 조정이 반복되므로 전체를 보관해
   재계산만으로 결과를 갱신할 수 있게 한다.

3) 결합 판정 근거는 배열 컬럼에 둔다
   별도 관계 테이블 대신 Finding.combination_with 에 rule_id 배열을 넣는다.
   라벨 스키마(label_schema.json)가 이미 같은 형태를 쓰고 있어 일관되며,
   조회 패턴이 "이 Finding 이 왜 승격됐나" 방향에 집중되어 있다.

4) Finding.fingerprint 로 회차 간 동일성을 판단한다
   상세는 fingerprint.py 참조.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Enum, Float, ForeignKey, Integer,
    JSON, String, Text, UniqueConstraint, Index,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------- 열거형


class FlowType(str, enum.Enum):
    """가입 Flow 인지 해지 Flow 인지. DA-06(취소·탈퇴 방해) 판정에 필요하다."""
    join = "join"
    cancel = "cancel"


class Severity(str, enum.Enum):
    HIGH = "HIGH"
    REVIEW = "REVIEW"
    LOW = "LOW"


class FindingStatus(str, enum.Enum):
    """
    회차 간 비교 결과.
      OPEN      이번 회차에서 발견됨
      RESOLVED  이전 회차에 있었으나 이번 회차에서 사라짐
      REGRESSED 해결됐던 문제가 다시 나타남
    """
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"
    REGRESSED = "REGRESSED"


class RunStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


# ---------------------------------------------------------------- 테이블


class Audit(Base):
    """하나의 금융상품 가입 Flow 에 대한 감사 세션."""
    __tablename__ = "audit"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    sector: Mapped[str | None] = mapped_column(String(40))        # insurance / deposit / loan / investment
    product_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    runs: Mapped[list[AuditRun]] = relationship(
        back_populates="audit", cascade="all, delete-orphan", order_by="AuditRun.version"
    )


class AuditRun(Base):
    """
    감사 회차. v1 은 최초 감사, v2 이후는 수정 후 재검증이다.
    Before/After 비교의 단위가 된다.
    """
    __tablename__ = "audit_run"
    __table_args__ = (UniqueConstraint("audit_id", "version", name="uq_run_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    audit_id: Mapped[int] = mapped_column(ForeignKey("audit.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)                 # 1, 2, 3 ...
    status: Mapped[RunStatus] = mapped_column(Enum(RunStatus), default=RunStatus.PENDING)
    note: Mapped[str | None] = mapped_column(Text)                # "사전선택 해제 후 재검증" 등
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    analysis_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    audit: Mapped[Audit] = relationship(back_populates="runs")
    screens: Mapped[list[Screen]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="Screen.screen_index"
    )
    findings: Mapped[list[Finding]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class Screen(Base):
    """가입 Flow 의 화면 한 장."""
    __tablename__ = "screen"
    __table_args__ = (
        UniqueConstraint("run_id", "flow_type", "screen_index", name="uq_screen_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("audit_run.id", ondelete="CASCADE"))
    flow_type: Mapped[FlowType] = mapped_column(Enum(FlowType), default=FlowType.join)
    screen_index: Mapped[int] = mapped_column(Integer)
    flow_step: Mapped[str | None] = mapped_column(String(200))
    image_path: Mapped[str | None] = mapped_column(String(400))
    viewport_w: Mapped[int | None] = mapped_column(Integer)
    viewport_h: Mapped[int | None] = mapped_column(Integer)
    analysis_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    run: Mapped[AuditRun] = relationship(back_populates="screens")
    elements: Mapped[list[Element]] = relationship(
        back_populates="screen", cascade="all, delete-orphan"
    )


class Element(Base):
    """
    화면에서 추출한 UI 요소. Finding 에 걸리지 않은 것도 전부 저장한다.

    탐지 임계값을 조정했을 때 화면을 다시 업로드하지 않고 재계산만으로
    결과를 갱신할 수 있어야 하기 때문이다.
    """
    __tablename__ = "element"
    __table_args__ = (Index("ix_element_screen", "screen_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    screen_id: Mapped[int] = mapped_column(ForeignKey("screen.id", ondelete="CASCADE"))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("element.id", ondelete="SET NULL"))

    # 생성 화면에서만 존재하는 DOM 기반 식별자.
    # 실제 스크린샷 입력에는 없으므로 평가의 주 키로 쓰지 않는다.
    dom_id: Mapped[str | None] = mapped_column(String(80))

    element_type: Mapped[str | None] = mapped_column(String(30))  # button / checkbox / text ...
    text: Mapped[str | None] = mapped_column(Text)

    # 정규화 좌표 0~1. 해상도가 달라도 임계값이 동일하게 걸리도록.
    bbox_x: Mapped[float] = mapped_column(Float)
    bbox_y: Mapped[float] = mapped_column(Float)
    bbox_w: Mapped[float] = mapped_column(Float)
    bbox_h: Mapped[float] = mapped_column(Float)

    # 선택 상태 등. {"checked": true, "disabled": false}
    state: Mapped[dict | None] = mapped_column(JSON)
    # 계산된 스타일. {"font_size": 14, "contrast_ratio": 3.2, "area_ratio": 0.08}
    computed_style: Mapped[dict | None] = mapped_column(JSON)

    source: Mapped[str] = mapped_column(String(20), default="dom")  # dom / ocr / vision[-grounded]
    confidence: Mapped[float | None] = mapped_column(Float)

    screen: Mapped[Screen] = relationship(back_populates="elements")

    @property
    def bbox(self) -> list[float]:
        return [self.bbox_x, self.bbox_y, self.bbox_w, self.bbox_h]


class Finding(Base):
    """탐지된 소비자보호 위험 후보."""
    __tablename__ = "finding"
    __table_args__ = (
        Index("ix_finding_run", "run_id"),
        Index("ix_finding_fp", "fingerprint"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("audit_run.id", ondelete="CASCADE"))

    rule_id: Mapped[str] = mapped_column(String(10))              # DA-01 ~ DA-15
    label_unit: Mapped[str] = mapped_column(String(20))           # element / screen / flow / flow_pair

    # 회차 간 동일 문제를 잇는 키. fingerprint.py 참조.
    fingerprint: Mapped[str] = mapped_column(String(60))

    # label_unit=element 일 때의 대표 요소
    primary_element_id: Mapped[int | None] = mapped_column(
        ForeignKey("element.id", ondelete="SET NULL")
    )
    # label_unit=screen / flow 일 때의 근거 화면
    screen_indices: Mapped[list | None] = mapped_column(JSON)

    # Rule Base 기본값과 최종값을 함께 남긴다.
    # 왜 승격·하향됐는지 추적하려면 둘 다 필요하다.
    base_severity: Mapped[Severity] = mapped_column(Enum(Severity))
    severity: Mapped[Severity] = mapped_column(Enum(Severity))

    # 결합 판정으로 승격된 경우 그 근거 rule_id 들. ["DA-04"]
    combination_with: Mapped[list | None] = mapped_column(JSON, default=list)
    # 완화 요건 충족 시 어떤 check 를 만족했는지. ["select_all_available"]
    mitigated_by: Mapped[list | None] = mapped_column(JSON, default=list)
    mitigated: Mapped[bool] = mapped_column(Boolean, default=False)

    status: Mapped[FindingStatus] = mapped_column(
        Enum(FindingStatus), default=FindingStatus.OPEN
    )
    confidence: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    run: Mapped[AuditRun] = relationship(back_populates="findings")
    primary_element: Mapped[Element | None] = relationship(foreign_keys=[primary_element_id])
    related: Mapped[list[FindingRelatedElement]] = relationship(
        back_populates="finding", cascade="all, delete-orphan"
    )
    evidence: Mapped[Evidence | None] = relationship(
        back_populates="finding", cascade="all, delete-orphan", uselist=False
    )


class FindingRelatedElement(Base):
    """
    관계를 구성하는 상대 요소.

    DA-02 · DA-03 · DA-11 은 관계 자체가 위반 요건이므로 최소 1건이 필요하다
    (Rule Base 의 related_required). 다대다이므로 조인 테이블로 둔다.
    """
    __tablename__ = "finding_related_element"
    __table_args__ = (
        UniqueConstraint("finding_id", "element_id", name="uq_finding_related"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int] = mapped_column(ForeignKey("finding.id", ondelete="CASCADE"))
    element_id: Mapped[int] = mapped_column(ForeignKey("element.id", ondelete="CASCADE"))
    role: Mapped[str | None] = mapped_column(String(40))   # "suppressed_option" 등

    finding: Mapped[Finding] = relationship(back_populates="related")
    element: Mapped[Element] = relationship()


class Evidence(Base):
    """
    Finding 하나에 대한 근거 패키지.
    담당자가 재검토할 수 있도록 동일 구조로 제공한다.
    """
    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int] = mapped_column(
        ForeignKey("finding.id", ondelete="CASCADE"), unique=True
    )

    where_text: Mapped[str | None] = mapped_column(Text)      # 어느 화면인가
    what_text: Mapped[str | None] = mapped_column(Text)       # 어떤 UI 요소인가
    observation: Mapped[str | None] = mapped_column(Text)     # 무엇이 관찰됐는가
    rule_ref: Mapped[str | None] = mapped_column(Text)        # 금융위 어떤 유형인가
    why_text: Mapped[str | None] = mapped_column(Text)        # 왜 선택을 왜곡할 수 있는가
    fix_text: Mapped[str | None] = mapped_column(Text)        # 어떻게 수정하는가

    # 어떤 deterministic check 가 걸렸는지. 재현과 디버깅에 쓴다.
    triggered_checks: Mapped[list | None] = mapped_column(JSON, default=list)
    # 계산된 실측값. {"area_ratio": 1.87, "contrast_ratio": 2.1}
    measurements: Mapped[dict | None] = mapped_column(JSON)

    finding: Mapped[Finding] = relationship(back_populates="evidence")
