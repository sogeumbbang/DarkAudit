import {
  ArrowRight,
  ChevronDown,
  ClipboardList,
  FileCheck2,
  ScanSearch,
  Upload,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Brand } from "@/components/common/Brand";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { guidelineCategories } from "@/pages/support/guidelines";

// Current baseline scope: ai/pipeline/baseline.py::MVP_RULE_IDS.
const automaticRuleIds = new Set(["DA-03", "DA-04", "DA-07", "DA-12", "DA-15"]);
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
    <figure className="mx-auto mt-10 max-w-4xl text-left">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4 sm:px-8">
          <span className="text-sm font-semibold">상세 결과</span>
          <span className="text-xs text-muted">서비스 화면 예시</span>
        </div>
        <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Badge variant="progress">검토 중</Badge>
            <h2 className="mt-4 text-xl font-bold">보험 가입 흐름</h2>
            <p className="mt-3 text-sm text-muted">화면 5개 · 탐지 3건 · 해결됨 1건</p>
            <div className="mt-6 rounded-control border border-border bg-background p-5">
              <p className="text-xs text-muted">화면 2 · 옵션 선택</p>
              <div className="mt-4 flex items-center gap-3 rounded-control border border-brand-300 bg-surface p-4">
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded bg-brand-600 text-sm text-white"
                >
                  ✓
                </span>
                <div className="text-sm">
                  <p className="font-semibold">안심케어 서비스</p>
                  <p className="mt-1 text-muted">월 3,000원 추가</p>
                </div>
              </div>
            </div>
          </div>
          <div className="md:border-l md:border-border md:pl-8">
            <p className="text-xs font-semibold text-brand-600">DA-04 · 검토 필요</p>
            <h3 className="mt-3 text-lg font-bold">특정옵션의 사전선택</h3>
            <p className="mt-3 text-sm leading-7 text-muted">
              선택적 유료 서비스가 미리 선택되어 있습니다. 사용자가 직접 선택한 항목인지 확인하세요.
            </p>
            <div className="mt-5 border-l-2 border-brand-400 pl-4">
              <p className="text-sm font-semibold">개선 권고</p>
              <p className="mt-2 text-sm leading-7 text-muted">
                초기 상태를 미선택으로 바꾸고, 추가 비용을 선택 항목 옆에 표시합니다.
              </p>
            </div>
          </div>
        </div>
      </Card>
      <figcaption className="mt-4 text-center text-xs leading-6 text-muted">
        AI가 근거를 제시하고, 담당자가 맥락을 확인해 수정 여부를 결정합니다.
      </figcaption>
    </figure>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-text">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="page-container grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-4 py-4 md:grid-cols-[1fr_auto_1fr] md:py-5">
          <Brand dark />
          <nav
            aria-label="랜딩 메뉴"
            className="col-span-2 row-start-2 flex items-center justify-center gap-7 text-sm font-medium text-muted sm:gap-10 md:col-span-1 md:col-start-2 md:row-start-1"
          >
            <a className="py-1 hover:text-brand-700" href="#product">
              서비스 소개
            </a>
            <a className="py-1 hover:text-brand-700" href="#standards">
              검토 기준
            </a>
            <Link className="py-1 hover:text-brand-700" to="/app/dashboard">
              대시보드
            </Link>
          </nav>
          <Button
            asChild
            className="col-start-2 row-start-1 justify-self-end px-4 text-xs sm:px-5 sm:text-sm md:col-start-3"
          >
            <Link to="/app/audits/new">진단 시작하기</Link>
          </Button>
        </div>
      </header>

      <main>
        <section
          className="page-container scroll-mt-40 pb-20 pt-16 text-center sm:pb-24 sm:pt-20 lg:pb-28 lg:pt-24"
          id="product"
        >
          <p className="text-xs font-semibold tracking-widest text-brand-600">
            금융상품 UX 검토 · DarkAudit
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl break-keep text-balance text-3xl font-bold leading-[1.35] tracking-tight sm:text-5xl lg:text-6xl">
            금융상품 UX를
            <br />
            <span className="text-brand-600">근거와 함께 검토하세요.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl break-keep text-base leading-8 text-muted sm:text-lg">
            사용자가 원하지 않는 선택을 하게 만드는 문구와 화면 설계, 다크패턴. DarkAudit은 금융상품
            화면에서 이런 위험 후보를 AI로 찾고, 근거 확인부터 개선 검토와 결과 관리까지 돕습니다.
          </p>
          <Button asChild className="mt-8 px-7 py-4">
            <Link to="/app/audits/new">
              진단 시작하기 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </Button>
          <p className="mt-4 text-xs leading-6 text-muted">
            준비한 자료가 없어도 데모를 선택해 바로 진단할 수 있습니다.
          </p>
          <ul
            aria-label="지원하는 입력"
            className="mt-9 flex flex-wrap justify-center gap-2 sm:gap-3"
          >
            {["웹사이트 URL", "Figma 시안", "Android APK", "스크린샷"].map((label) => (
              <li
                key={label}
                className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-muted"
              >
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="page-container pb-20 sm:pb-24" aria-labelledby="use-cases-title">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-widest text-brand-600">
              이럴 때 활용하세요
            </p>
            <h2
              id="use-cases-title"
              className="mt-4 break-keep text-balance text-2xl font-bold leading-snug sm:text-3xl"
            >
              화면을 만드는 순간부터, 운영 중인 서비스까지
            </h2>
            <p className="mt-4 break-keep text-sm leading-7 text-muted">
              미리 선택된 유료 옵션, 눈에 잘 띄지 않는 조건처럼 놓치기 쉬운 요소를 살펴보세요. 팀의
              업무 단계에 맞는 자료로 검토를 시작할 수 있습니다.
            </p>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {useCases.map(({ role, timing, question, description }) => (
              <Card key={role} className="p-6 sm:p-8">
                <p className="text-xs font-semibold text-brand-600">{role}</p>
                <h3 className="mt-4 break-keep text-lg font-bold leading-7">{question}</h3>
                <p className="mt-5 text-sm font-medium">{timing}</p>
                <p className="mt-2 break-keep text-sm leading-7 text-muted">{description}</p>
              </Card>
            ))}
          </div>
        </section>

        <section
          className="border-y border-border bg-surface py-20 sm:py-24"
          aria-labelledby="process-title"
          id="process"
        >
          <div className="page-container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold tracking-widest text-brand-600">
                서비스 동작 방식
              </p>
              <h2
                id="process-title"
                className="mt-4 break-keep text-balance text-2xl font-bold leading-snug sm:text-3xl"
              >
                화면 입력부터 검토 결과 관리까지
              </h2>
              <p className="mt-4 text-sm leading-7 text-muted">
                AI 진단을 시작으로, 담당자의 판단과 수정 기록까지 하나의 흐름으로 이어집니다.
              </p>
            </div>
            <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map(({ icon: Icon, title, description }, index) => (
                <li
                  key={title}
                  className="rounded-card border border-border bg-background p-6 sm:p-7"
                >
                  <div className="flex items-center justify-between">
                    <Icon size={24} className="text-brand-600" aria-hidden="true" />
                    <span className="text-xs font-semibold tabular-nums text-muted">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold">{title}</h3>
                  <p className="mt-3 break-keep text-sm leading-7 text-muted">{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="page-container py-20 sm:py-24" aria-labelledby="results-title">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-widest text-brand-600">
              진단 후 얻는 결과
            </p>
            <h2
              id="results-title"
              className="mt-4 break-keep text-balance text-2xl font-bold leading-snug sm:text-3xl"
            >
              발견한 문제를, 수정할 수 있는 근거로
            </h2>
            <p className="mt-4 break-keep text-sm leading-7 text-muted">
              어떤 화면에서 무엇이 발견됐는지, 어떻게 바꾸면 좋을지 함께 확인하세요. AI가 제시한
              위험 후보를 담당자가 검토하고 판단을 기록합니다.
            </p>
          </div>
          <ReviewPreview />
          <dl className="mx-auto mt-10 grid max-w-4xl gap-7 sm:grid-cols-3">
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

        <section
          className="page-container scroll-mt-36 py-20 sm:py-24 lg:py-28"
          id="standards"
          aria-labelledby="standards-title"
        >
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-widest text-brand-600">검토 기준</p>
            <h2
              id="standards-title"
              className="mt-4 break-keep text-balance text-2xl font-bold leading-snug sm:text-3xl"
            >
              15개 기준을 모두 공개합니다.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted">
              금융위원회 가이드라인의 4개 범주를 바탕으로 검토합니다.
              <br />
              현재 MVP는 5개 유형을 자동 탐지하며, 나머지는 담당자가 직접 검토합니다.
            </p>
            <p className="mt-3 text-xs leading-6 text-muted">
              자동 탐지 항목도 입력 화면과 근거에 따라 검사 범위가 달라집니다. 실제 검사 여부는 진단
              결과에서 확인하세요.
            </p>
          </div>
          <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
            {guidelineCategories.map((category) => (
              <Card key={category.id} className="overflow-hidden">
                <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5 sm:px-7">
                  <h3 className="text-lg font-semibold">{category.title}</h3>
                  <span className="text-xs text-muted">{category.types.length}개 유형</span>
                </div>
                <ul className="divide-y divide-border">
                  {category.types.map((rule) => (
                    <li key={rule.id}>
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-7 [&::-webkit-details-marker]:hidden">
                          <span className="shrink-0 text-xs tabular-nums text-muted">
                            {rule.id.slice(3)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-keep text-sm font-semibold leading-6">
                              {rule.title}
                            </span>
                            <span
                              className={`mt-1 block text-xs ${automaticRuleIds.has(rule.id) ? "font-semibold text-brand-600" : "text-muted"}`}
                            >
                              {automaticRuleIds.has(rule.id) ? "MVP 자동 탐지" : "담당자 검토"}
                            </span>
                          </span>
                          <ChevronDown
                            size={16}
                            className="shrink-0 text-muted group-open:rotate-180"
                            aria-hidden="true"
                          />
                        </summary>
                        <div className="px-6 pb-6 sm:px-7">
                          <p className="text-sm leading-7 text-muted">{rule.description}</p>
                          <p className="mt-3 border-l-2 border-brand-300 pl-4 text-sm leading-7">
                            {rule.checkpoint}
                          </p>
                          {"note" in rule && (
                            <p className="mt-3 text-xs leading-6 text-muted">{rule.note}</p>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm font-medium text-brand-700">
            <Link className="underline-offset-4 hover:underline" to="/app/guidelines">
              검토 기준 자세히 보기 →
            </Link>
            <a
              className="underline-offset-4 hover:underline"
              href="https://www.fsc.go.kr/po010101/85942"
              target="_blank"
              rel="noopener noreferrer"
            >
              금융위원회 공식 원문 <span className="sr-only">(새 탭)</span>↗
            </a>
          </div>
        </section>
      </main>
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
