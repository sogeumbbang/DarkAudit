import { brandLogo } from "@/components/common/brandLogo";
import { ArrowDownRight, ArrowRight, Check, FileText, MessageSquare, ScanLine } from "lucide-react";
import { LandingPhoto } from "./LandingPhoto";
import { ScreenCanvas } from "@/features/finding-review/ScreenCanvas";
import type { AuditScreenDto, FindingDto } from "@/entities/audit/types";

const exampleScreen: AuditScreenDto = {
  id: "landing-option",
  order: 2,
  flowStep: "옵션 선택",
  imageUrl: "/sample-audit/02-preselected-addon.png",
  findingCount: 1,
  width: 786,
  height: 1704,
};
const exampleFinding: FindingDto = {
  id: "landing-preselection",
  ruleId: "DA-04",
  riskType: "PRESELECTED_OPTION",
  title: "유료 옵션 사전 선택",
  description: "선택 사항인 유료 특약이 미리 선택되어 있습니다.",
  screenIds: [exampleScreen.id],
  element: "피부질환 케어 특약 체크박스",
  severity: "REVIEW",
  status: "open",
  confidence: 0,
  recommendation: "선택 특약의 기본 체크를 해제하세요.",
  guideline: "특정옵션의 사전선택",
  bbox: {
    screenId: exampleScreen.id,
    x: 48,
    y: 645,
    width: 690,
    height: 161,
    coordinateSystem: "image",
  },
};

export function Status({
  children = "검토 필요",
  safe = false,
}: {
  children?: React.ReactNode;
  safe?: boolean;
}) {
  return (
    <span className={`lp-status${safe ? " lp-status-safe" : ""}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** Static illustrations of the existing fictional demo, not live audit results. */
export function OptionRow({
  selected = true,
  compact = false,
}: {
  selected?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`lp-option${selected ? " is-selected" : " is-clear"}${compact ? " is-compact" : ""}`}
    >
      <span className="lp-checkbox" aria-hidden="true">
        {selected && <Check size={14} strokeWidth={3} />}
      </span>
      <div>
        <strong>피부질환 케어 특약</strong>
        <span>선택 사항 · 월 3,200원 추가</span>
      </div>
      {!compact && <span className="lp-option-label">{selected ? "기본 선택" : "직접 선택"}</span>}
    </div>
  );
}

export function MiniScreen({
  corrected = false,
  photographic = false,
}: {
  corrected?: boolean;
  photographic?: boolean;
}) {
  return (
    <div className={`lp-mini-screen${photographic ? " lp-mini-screen-photographic" : ""}`}>
      {photographic ? (
        <div className="lp-screen-photo">
          <LandingPhoto
            kind="pet"
            priority
            sizes="(max-width: 639px) 85vw, (max-width: 959px) 320px, 380px"
          />
          <span className="lp-screen-photo-brand">
            moru<span>.</span> <small>가입 화면 예시</small>
          </span>
        </div>
      ) : (
        <>
          <div className="lp-screen-brand">
            <span>
              moru<span>.</span>
            </span>
            <span>가입 화면 예시</span>
          </div>
          <div className="lp-screen-progress">
            <i />
            <i />
            <i />
            <i />
          </div>
        </>
      )}
      <p className="lp-tiny">02 / 보장 선택</p>
      <p className="lp-screen-title">
        우리 아이에게 맞는
        <br />
        보장을 골라주세요.
      </p>
      <p className="lp-screen-description">필요한 보장과 비용을 확인해 주세요.</p>
      <div className="lp-base-cover">
        <span>기본 보장</span>
        <strong>상해 · 질병 의료비</strong>
        <Check size={15} aria-hidden="true" />
      </div>
      <div className={`lp-annotated-option${corrected ? " is-corrected" : ""}`}>
        <span className="lp-annotation-label">
          {corrected ? "사용자가 직접 선택" : "DA-04 · 사전선택 탐지"}
        </span>
        <OptionRow selected={!corrected} compact />
      </div>
      <div className="lp-screen-bottom">
        <span>추가 비용을 확인한 후 진행해 주세요.</span>
        <span>
          다음 <ArrowRight size={13} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

export function FindingCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`lp-finding-card${compact ? " is-compact" : ""}`}>
      <div className="lp-card-meta">
        <span className="lp-tiny">탐지 결과 01</span>
        <Status />
      </div>
      <p className="lp-card-title">
        고르기도 전에
        <br />
        이미 선택돼 있습니다.
      </p>
      <p className="lp-card-description">
        유료 특약이 기본으로 선택되어
        <br className="lp-desktop-break" /> 추가 비용이 발생할 수 있습니다.
      </p>
      <div className="lp-card-footer">
        <span>특정옵션의 사전선택</span>
        <span className="lp-rule-code">DA-04</span>
      </div>
    </div>
  );
}

export function RuleCard() {
  return (
    <div className="lp-rule-card">
      <div className="lp-card-meta">
        <span className="lp-tiny">검토 기준</span>
        <ArrowDownRight size={19} aria-hidden="true" />
      </div>
      <div className="lp-rule-heading">
        <strong>DA–04</strong>
        <span>오도형 ④</span>
      </div>
      <p>특정옵션의 사전선택</p>
      <span className="lp-card-description">화면에서 발견한 문제에 해당하는 검토 기준입니다.</span>
    </div>
  );
}

export function EvidenceCard() {
  return (
    <div className="lp-evidence-card">
      <span className="lp-tiny">화면 속 근거</span>
      <div className="lp-evidence-quote">
        <span aria-hidden="true">“</span>
        <p>
          피부질환 케어 특약
          <br />
          <strong>월 3,200원 추가</strong>
        </p>
      </div>
      <div className="lp-card-footer">
        <span>02 · 옵션 선택 화면</span>
        <ScanLine size={18} aria-hidden="true" />
      </div>
    </div>
  );
}

export function FixCard() {
  return (
    <div className="lp-fix-card">
      <div className="lp-card-meta">
        <span className="lp-tiny">개선 권고</span>
        <ArrowRight size={19} aria-hidden="true" />
      </div>
      <p className="lp-card-title">사용자가 직접 선택하도록 바꾸세요.</p>
      <p className="lp-card-description">기본 체크를 해제하고 추가 비용을 명확하게 표시하세요.</p>
      <OptionRow selected={false} compact />
    </div>
  );
}

export function AnnotatedScreen() {
  return (
    <div className="lp-real-screen">
      <ScreenCanvas
        screen={exampleScreen}
        finding={exampleFinding}
        alt="월 3,200원 유료 특약이 사전선택된 가상 보험 화면과 DA-04 위치 표시"
        className="block h-auto w-full"
        autoCenter={false}
      />
    </div>
  );
}

export function ReviewNote() {
  return (
    <div className="lp-review-note">
      <span className="lp-note-icon">
        <MessageSquare size={17} aria-hidden="true" />
      </span>
      <div>
        <span className="lp-tiny">검토 의견 예시</span>
        <p>
          보장 내용과 비용을 확인한 뒤<br />
          직접 선택할 수 있도록 바꿔야 합니다.
        </p>
      </div>
    </div>
  );
}

export function ReportPreview({ mini = false }: { mini?: boolean }) {
  return (
    <div className={`lp-report${mini ? " lp-report-mini" : ""}`}>
      <div className="lp-report-top">
        <span>
          <img alt="DarkAudit" className="lp-brand-logo" src={brandLogo({ dark: true })} />
        </span>
        <span>검토 보고서</span>
      </div>
      <div className="lp-report-body">
        <span className="lp-tiny">금융 UX 진단 · 보고서 예시</span>
        <p className="lp-report-title">
          검토한 내용을
          <br />
          기록으로 남깁니다.
        </p>
        <div className="lp-report-subject">
          <FileText size={18} aria-hidden="true" />
          <span>
            펫보험 가입 흐름<span>검토 대상 · 옵션 선택 화면</span>
          </span>
          <span className="lp-rule-code">PDF</span>
        </div>
        <div className="lp-report-line">
          <span>발견 항목</span>
          <strong>유료 옵션 사전선택</strong>
        </div>
        <div className="lp-report-line">
          <span>검토 기준</span>
          <strong>DA-04</strong>
        </div>
        <div className="lp-report-excerpt">
          <span className="lp-tiny">관찰 내용</span>
          <p>선택 사항인 유료 특약이 미리 선택되어 있습니다.</p>
          <div className="lp-document-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
        {!mini && (
          <div className="lp-report-fix">
            <Check size={16} aria-hidden="true" />
            <p>
              개선 권고<span>선택 특약의 기본 체크를 해제합니다.</span>
            </p>
          </div>
        )}
      </div>
      <div className="lp-report-bottom">
        <span>근거 · 기준 · 개선 권고</span>
        <span>01</span>
      </div>
    </div>
  );
}

export function FindingWorkspace() {
  return (
    <div className="lp-workspace-composition">
      <div className="lp-workspace">
        <div className="lp-workspace-bar">
          <strong>
            <img alt="DarkAudit" className="lp-brand-logo" src={brandLogo()} />
          </strong>
          <span>
            펫보험 가입 흐름 <span aria-hidden="true">/</span> 화면 검토
          </span>
          <span className="lp-demo-tag">진단 예시</span>
        </div>
        <div className="lp-workspace-body">
          <div className="lp-workspace-canvas">
            <div className="lp-card-meta">
              <span className="lp-tiny">발견 위치 / 02 · 옵션 선택</span>
              <ScanLine size={18} aria-hidden="true" />
            </div>
            <AnnotatedScreen />
            <div className="lp-canvas-caption">
              <span className="lp-annotation-dot" />
              유료 특약 체크박스
            </div>
          </div>
          <div className="lp-workspace-detail">
            <div className="lp-card-meta">
              <span className="lp-tiny">탐지 결과 01</span>
              <Status />
            </div>
            <span className="lp-tiny lp-what">발견한 문제</span>
            <h3>
              유료 옵션
              <br />
              사전선택
            </h3>
            <div className="lp-observation">
              <span className="lp-tiny">관찰 내용</span>
              <p>월 3,200원이 추가되는 피부질환 케어 특약이 기본 선택되어 있습니다.</p>
            </div>
            <div className="lp-workspace-rule">
              <span className="lp-tiny">검토 기준</span>
              <span className="lp-rule-code">DA-04</span>
              <span>특정옵션의 사전선택</span>
            </div>
            <div className="lp-why">
              <span className="lp-tiny">검토가 필요한 이유</span>
              <p>사용자가 모르는 사이에 추가 비용이 드는 옵션이 선택될 수 있습니다.</p>
            </div>
            <div className="lp-workspace-fix">
              <span className="lp-tiny">개선 방향</span>
              <p>
                기본 선택을 해제해
                <br />
                <strong>사용자가 직접 선택하도록 바꾸세요.</strong>
              </p>
              <ArrowDownRight size={22} aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Editorial interlude connecting the review UI to everyday consumer choice. */
export function ChoiceStory() {
  return (
    <section className="lp-choice-section" aria-labelledby="lp-choice-title">
      <div className="lp-container lp-story-scene">
        <div className="lp-story-photo">
          <LandingPhoto kind="choice" sizes="(max-width: 639px) 100vw, 900px" />
        </div>
        <div className="lp-story-copy">
          <p className="lp-eyebrow">
            <span /> 화면 너머의 사용자
          </p>
          <h2 id="lp-choice-title">
            검토하는 건 화면,
            <br />
            지키려는 건 선택.
          </h2>
          <p>
            한 번의 체크, 한 줄의 안내가
            <br />
            누군가의 금융 생활을 바꿀 수 있습니다.
            <br />
            사용자가 분명히 알고 선택하도록 돕습니다.
          </p>
        </div>
      </div>
    </section>
  );
}
