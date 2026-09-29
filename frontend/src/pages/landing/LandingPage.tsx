import { ArrowRight, ClipboardList, FileCheck2, ScanSearch, Upload, Menu, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Brand } from "@/components/common/Brand";
import { Button } from "@/components/ui/Button";
import { HeroGraphic } from "./HeroGraphic";

import "./landing.css";

const steps = [
  {
    icon: Upload,
    title: "화면 입력",
    description: "운영 중인 웹사이트 URL, Figma 시안, Android APK 또는 스크린샷을 등록합니다.",
  },
  {
    icon: ScanSearch,
    title: "AI 진단",
    description: "지원 유형에 해당하는 문구와 UI 패턴을 찾아 화면 속 근거와 함께 제시합니다.",
  },
  {
    icon: FileCheck2,
    title: "담당자 검토",
    description: "탐지 근거와 개선 권고를 확인하고, 수정 결정과 해결 상태를 기록합니다.",
  },
  {
    icon: ClipboardList,
    title: "결과 관리",
    description: "진단 목록에서 이전 결과를 다시 확인하고 PDF 보고서로 공유합니다.",
  },
];

const useCases = [
  {
    role: "기획 · 디자인",
    timing: "출시 전, 설계한 화면을 점검할 때",
    question: "선택을 유도하는 화면은 없을까요?",
    description:
      "Figma 시안이나 스크린샷으로 버튼 문구, 옵션의 기본값, 정보 배치를 살펴보고 수정할 부분을 찾습니다.",
  },
  {
    role: "서비스 운영 · QA",
    timing: "운영 중인 가입 흐름을 확인할 때",
    question: "다음 화면에서 조건이 달라지나요?",
    description:
      "웹사이트나 Android 앱의 이용 흐름을 진단하고, 화면별로 발견된 위험 후보와 근거를 확인합니다.",
  },
  {
    role: "검토 담당자",
    timing: "개선 여부를 판단하고 공유할 때",
    question: "무엇을 근거로 수정해야 할까요?",
    description:
      "탐지된 항목을 기준과 대조해 검토 의견과 해결 상태를 남기고, PDF 보고서로 결과를 공유합니다.",
  },
];

const deliverables = [
  {
    title: "어디를 확인할지",
    description: "위험 후보가 발견된 화면과 위치, 탐지 근거를 함께 확인합니다.",
  },
  {
    title: "어떻게 개선할지",
    description: "항목별 개선 권고를 읽고 서비스 맥락에 맞는 수정 방향을 정합니다.",
  },
  {
    title: "무엇이 처리됐는지",
    description: "검토 의견과 해결 상태를 기록하고, 진단 기록과 PDF로 다시 확인합니다.",
  },
];

function ReviewPreview() {
  return (
    <figure className="review-preview">
      <div className="preview-toolbar">
        <span className="flex items-center gap-2">
          <ScanSearch size={16} aria-hidden="true" /> 화면 검토
        </span>
        <span className="text-xs text-muted">서비스 화면 예시</span>
      </div>
      <div className="preview-canvas">
        <div className="preview-flow" aria-hidden="true">
          <span>01 상품 안내</span>
          <span className="text-brand-700">02 옵션 선택</span>
          <span>03 가입 확인</span>
        </div>
        <div className="preview-screen">
          <div className="flex items-center justify-between border-b border-border pb-4 text-xs text-muted">
            <span>보험 가입</span>
            <span>02 / 03</span>
          </div>
          <p className="mt-6 text-xl font-semibold">보장 옵션을 선택하세요.</p>
          <p className="mt-2 text-xs text-muted">나에게 필요한 서비스를 확인해 주세요.</p>
          <div className="preview-detection">
            <span className="preview-marker">01 · 검토 필요</span>
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center bg-brand-600 text-sm text-white"
            >
              ✓
            </span>
            <div className="flex-1 text-sm">
              <p className="font-semibold">안심케어 서비스</p>
              <p className="mt-1 text-xs text-muted">월 3,000원 추가</p>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted"
          >
            <span>선택한 보장 확인</span>
            <ArrowRight size={14} />
          </div>
        </div>
        <span className="preview-coordinate" aria-hidden="true">
          SCREEN 02 / FINDING 01
        </span>
      </div>
      <div className="preview-evidence">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-brand-600">DA-04</span>
          <span className="text-xs text-warning">담당자 검토 필요</span>
        </div>
        <h2 className="mt-3 text-lg font-semibold">특정옵션의 사전선택</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          선택적 유료 서비스가 미리 선택되어 있습니다. 사용자가 직접 선택한 항목인지 확인하세요.
        </p>
        <div className="mt-4 border-l-2 border-brand-600 pl-4 text-sm leading-6">
          <p className="font-semibold">개선 권고</p>
          <p className="mt-1 text-muted">
            초기 상태를 미선택으로 바꾸고, 추가 비용을 선택 항목 옆에 표시합니다.
          </p>
        </div>
      </div>
      <figcaption className="border-t border-border px-5 py-3 text-xs leading-5 text-muted">
        AI가 근거를 제시하고, 담당자가 수정 여부를 결정합니다.
      </figcaption>
    </figure>
  );
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="landing-page min-h-screen bg-background text-text">
      <header
        className="landing-header sticky top-0 z-30 bg-surface/95 backdrop-blur"
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false);
            menuButtonRef.current?.focus();
          }
        }}
      >
        <div className="page-container landing-header-inner">
          <Brand dark />
          <nav
            aria-label="랜딩 메뉴"
            id="landing-navigation"
            data-open={menuOpen}
            className="landing-navigation text-sm font-medium text-muted"
            onClick={() => setMenuOpen(false)}
          >
            <a className="py-1 hover:text-brand-700" href="#product">
              서비스 소개
            </a>
            <Link className="py-1 hover:text-brand-700" to="/app/guidelines">
              검토 기준
            </Link>
            <Link className="py-1 hover:text-brand-700" to="/app/dashboard">
              대시보드
            </Link>
          </nav>
          <button
            ref={menuButtonRef}
            type="button"
            className="landing-menu-toggle"
            aria-label={menuOpen ? "랜딩 메뉴 닫기" : "랜딩 메뉴 열기"}
            aria-expanded={menuOpen}
            aria-controls="landing-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main>
        <section className="landing-hero page-container" id="product">
          <div className="hero-copy">
            <p className="section-index hero-eyebrow">금융상품 UX를 위한 AI 사전점검</p>
            <h1>
              다 만든 화면,
              <br />
              <span>다 살펴본 건가요?</span>
            </h1>
            <p className="hero-description">
              놓치기 쉬운 다크패턴 위험부터 수정이 필요한 이유까지.
              <br />
              금융상품 가입 화면을 근거와 함께 검토하세요.
            </p>
            <Button asChild variant="primary" className="landing-action mt-8 gap-10 px-7 py-4">
              <Link to="/app/audits/new">
                내 화면 점검하기 <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <HeroGraphic />
        </section>
        <section
          className="page-container landing-section use-cases-section"
          aria-labelledby="use-cases-title"
        >
          <div className="section-heading">
            <p className="section-index">이럴 때 활용하세요</p>
            <h2
              id="use-cases-title"
              className="font-display mt-4 break-keep text-balance text-2xl font-bold leading-snug sm:text-3xl"
            >
              화면을 만드는 순간부터, 운영 중인 서비스까지
            </h2>
            <p className="mt-4 break-keep text-sm leading-7 text-muted">
              미리 선택된 유료 옵션, 눈에 잘 띄지 않는 조건처럼 놓치기 쉬운 요소를 살펴보세요. 팀의
              업무 단계에 맞는 자료로 검토를 시작할 수 있습니다.
            </p>
          </div>
          <div className="use-case-list">
            {useCases.map(({ role, timing, question, description }, index) => (
              <div key={role} className="use-case-row">
                <div className="use-case-role">
                  <span className="section-number">0{index + 1}</span>
                  <p>{role}</p>
                </div>
                <h3>{question}</h3>
                <div>
                  <p className="text-sm font-semibold">{timing}</p>
                  <p className="mt-3 text-sm leading-7 text-muted">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="process-section" aria-labelledby="process-title" id="process">
          <div className="page-container">
            <div className="section-heading">
              <p className="section-index">서비스 동작 방식</p>
              <h2
                id="process-title"
                className="font-display mt-4 break-keep text-balance text-2xl font-bold leading-snug sm:text-3xl"
              >
                화면 입력부터 검토 결과 관리까지
              </h2>
              <p className="mt-4 text-sm leading-7 text-muted">
                AI 진단을 시작으로, 담당자의 판단과 수정 기록까지 하나의 흐름으로 이어집니다.
              </p>
            </div>
            <ol className="process-list">
              {steps.map(({ icon: Icon, title, description }, index) => (
                <li key={title} className="process-row">
                  <span className="section-number">0{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <Icon size={26} strokeWidth={1.25} aria-hidden="true" />
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="page-container landing-section results-section"
          aria-labelledby="results-title"
        >
          <div className="section-heading">
            <p className="section-index">진단 후 얻는 결과</p>
            <h2
              id="results-title"
              className="font-display mt-4 break-keep text-balance text-2xl font-bold leading-snug sm:text-3xl"
            >
              발견한 문제를, 수정할 수 있는 근거로
            </h2>
            <p className="mt-4 break-keep text-sm leading-7 text-muted">
              어떤 화면에서 무엇이 발견됐는지, 어떻게 바꾸면 좋을지 함께 확인하세요. AI가 제시한
              위험 후보를 담당자가 검토하고 판단을 기록합니다.
            </p>
          </div>
          <ReviewPreview />
          <dl className="results-deliverables mt-10 grid gap-7 sm:grid-cols-3">
            {deliverables.map(({ title, description }, index) => (
              <div key={title} className="border-t border-border pt-5">
                <dt className="text-sm font-bold">
                  <span className="mr-2 text-brand-600">0{index + 1}</span>
                  {title}
                </dt>
                <dd className="mt-3 break-keep text-sm leading-7 text-muted">{description}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <section className="landing-closing" aria-labelledby="closing-title">
        <div className="page-container">
          <div>
            <h2 id="closing-title">
              이제, 내 화면을
              <br />
              살펴볼 차례
            </h2>
          </div>
          <div>
            <Button asChild variant="primary" className="landing-action gap-10 px-7 py-4">
              <Link to="/app/audits/new">
                화면 등록하고 시작하기 <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
      <footer className="border-t border-border bg-surface py-8">
        <div className="page-container flex flex-wrap items-center justify-between gap-4">
          <Brand dark />
          <p className="text-xs leading-6 text-muted">
            금융상품 화면을 검토하고, 개선의 근거를 남깁니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
