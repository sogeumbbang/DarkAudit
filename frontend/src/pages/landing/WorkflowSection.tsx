import { ArrowUpRight, Check, FileText, Upload } from "lucide-react";
import { LandingPhoto } from "./LandingPhoto";

const steps = [
  {
    title: "화면 입력",
    description: "웹사이트 URL, Figma 시안, Android APK 또는 스크린샷을 등록합니다.",
  },
  {
    title: "AI 진단",
    description:
      "지원하는 다크패턴 유형에 해당하는 문구와 UI 패턴을 찾아 화면 속 근거와 함께 보여줍니다.",
  },
  {
    title: "담당자 검토",
    description: "탐지 근거와 개선 권고를 확인하고 수정 여부와 해결 상태를 기록합니다.",
  },
  {
    title: "결과 관리",
    description: "진단 목록에서 이전 결과를 다시 확인하고 PDF 보고서로 공유합니다.",
  },
];

/** Read-only examples of the existing review steps. */
function StepPreview({ stage }: { stage: number }) {
  if (stage === 0) {
    return (
      <div className="lp-step-preview lp-step-upload">
        <Upload size={21} strokeWidth={1.5} />
        <strong>화면을 등록하세요</strong>
        <span>URL · Figma · APK · 이미지</span>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className="lp-step-preview lp-step-findings">
        <span className="lp-step-label">발견한 위험 후보</span>
        <div>
          <i />
          <strong>유료 옵션 사전선택</strong>
          <span>DA-04</span>
        </div>
        <div>
          <Check size={12} />
          <span>화면 속 근거 확인</span>
          <ArrowUpRight size={12} />
        </div>
      </div>
    );
  }
  if (stage === 2) {
    return (
      <div className="lp-step-preview lp-step-review">
        <div>
          <span className="lp-step-avatar">검</span>
          <strong>담당자 검토</strong>
          <span>의견 예시</span>
        </div>
        <p>기본 선택을 해제해 주세요.</p>
        <span className="lp-step-review-status">
          <i />
          검토 중
        </span>
      </div>
    );
  }
  return (
    <div className="lp-step-preview lp-step-report">
      <div>
        <FileText size={15} />
        <strong>검토 보고서</strong>
        <span>PDF</span>
      </div>
      <span className="lp-step-report-line" />
      <span className="lp-step-report-line" />
      <div className="lp-step-report-bottom">
        <span>탐지 근거 · 개선 권고</span>
        <ArrowUpRight size={12} />
      </div>
    </div>
  );
}

export function WorkflowSection() {
  return (
    <section
      className="lp-section lp-flow-section lp-process"
      id="process"
      aria-labelledby="process-title"
    >
      <div className="lp-process-story">
        <div className="lp-process-copy">
          <p className="lp-eyebrow">
            <span className="lp-chapter-number">02</span> 검토 과정
          </p>
          <h2 id="process-title">
            화면 입력부터 <br />
            검토 결과 관리까지
          </h2>
          <p>
            AI가 근거를 찾고 담당자가 판단합니다.
            <br />
            화면 입력부터 결과 관리까지 이어집니다.
          </p>
        </div>
        <figure className="lp-process-photo">
          <LandingPhoto kind="workspace" sizes="(max-width: 959px) 90vw, 46vw" />
          <figcaption>
            더 명확한 화면은
            <br />
            세심한 검토에서 시작됩니다.
          </figcaption>
        </figure>
      </div>
      <div className="lp-process-steps">
        <ol>
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="lp-process-number">0{index + 1}</span>
              <div className="lp-process-step-copy">
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
              <div aria-hidden="true">
                <StepPreview stage={index} />
              </div>
            </li>
          ))}
        </ol>
        <p className="lp-process-example">이해를 돕기 위한 검토 화면 예시입니다.</p>
      </div>
    </section>
  );
}
