import {
  ArrowRight,
  Building2,
  Check,
  FileCheck2,
  HeartHandshake,
  ScanSearch,
  ShieldCheck,
  Upload,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Brand } from "@/components/common/Brand";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const patterns = [
  {
    number: "01",
    title: "사전선택",
    description: "선택적 서비스가 기본으로 활성화되어 추가 비용이 발생할 수 있습니다.",
    preview: (
      <div className="flex items-center gap-3 rounded-control bg-white p-4 shadow-lg">
        <span className="flex size-5 items-center justify-center rounded bg-brand-600 text-white">
          <Check size={13} />
        </span>
        <span className="text-xs text-muted">
          부가서비스
          <strong className="mt-0.5 block font-medium text-text">+3,000원</strong>
        </span>
      </div>
    ),
  },
  {
    number: "02",
    title: "감정적 압박",
    description: "거절하거나 나가려는 선택에 부담을 주는 문구와 표현이 사용될 수 있습니다.",
    preview: (
      <div className="rounded-control bg-white p-4 text-center shadow-lg">
        <p className="text-xs leading-5 text-muted">
          혜택을 포기하고
          <br />
          나가시겠어요?
        </p>
        <span className="mt-3 block rounded border border-brand-400 px-5 py-2 text-xs text-brand-700">
          나가기
        </span>
      </div>
    ),
  },
  {
    number: "03",
    title: "순차공개 가격책정",
    description: "전체 비용 정보가 과정 후반에 드러나 실제 가격을 왜곡할 수 있습니다.",
    preview: (
      <div className="rounded-control bg-white p-4 shadow-lg">
        <p className="text-[10px] text-muted">초기 안내</p>
        <p className="mt-1 font-bold">월 9,900원</p>
        <div className="my-3 h-px bg-border" />
        <p className="text-[10px] text-muted">최종 결제</p>
        <p className="mt-1 font-bold text-danger">월 12,900원</p>
      </div>
    ),
  },
];

function ProductMockup() {
  return (
    <div className="relative mx-auto max-w-xl pb-12 sm:pr-12">
      <Card className="overflow-hidden border-white/15 bg-white text-text shadow-2xl">
        <div className="grid grid-cols-[105px_1fr] sm:grid-cols-[125px_1fr]">
          <div className="bg-brand-950 p-4 text-white">
            <p className="text-xs font-bold">⌂ DarkAudit</p>
            <div className="mt-6 space-y-3 text-[9px] text-white/50">
              <p className="rounded bg-brand-600 px-2 py-2 text-white">대시보드</p>
              <p className="px-2">진단 관리</p>
              <p className="px-2">검토 기준</p>
              <p className="px-2">설정</p>
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold">대시보드</p>
              <span className="rounded bg-brand-950 px-2 py-1 text-[7px] text-white">
                + 새 진단
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["전체 진단", "12"],
                ["검토 필요", "18"],
                ["높은 우선 검토", "4"],
              ].map(([label, value]) => (
                <div className="rounded border border-border p-3" key={label}>
                  <p className="text-[7px] text-muted">{label}</p>
                  <p className="mt-1 text-lg font-bold">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[10px] font-bold">최근 진단</p>
            <div className="mt-2 divide-y divide-border rounded border border-border text-[7px]">
              {["보험 가입 흐름 v1", "적금 가입 흐름 v2", "대출 신청 흐름 v1"].map(
                (name, index) => (
                  <div className="grid grid-cols-[1fr_auto] items-center gap-2 p-3" key={name}>
                    <span>{name}</span>
                    <span className={index === 1 ? "text-success" : "text-danger"}>
                      {index === 1 ? "완료" : "검토 필요"}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </Card>
      <div className="absolute -bottom-1 right-0 hidden h-[300px] w-[154px] rotate-2 rounded-[30px] border-[7px] border-[#222] bg-[#f9faf9] p-3 text-text shadow-2xl sm:block">
        <div className="mx-auto mb-8 h-1.5 w-10 rounded-full bg-black/70" />
        <p className="text-[8px] font-bold">옵션 선택</p>
        <p className="mt-7 text-[7px] text-muted">월 보험료</p>
        <p className="mt-1 text-xl font-bold">
          9,900<span className="text-[8px]">원</span>
        </p>
        <div className="mt-5 flex items-center gap-2 rounded bg-white p-2 shadow-md">
          <span className="flex size-4 items-center justify-center rounded bg-brand-600 text-white">
            <Check size={10} />
          </span>
          <span className="text-[7px]">
            안심케어 서비스
            <br />
            +3,000원 / 월
          </span>
        </div>
        <div className="absolute inset-x-3 bottom-4 rounded bg-brand-600 py-2 text-center text-[8px] text-white">
          다음
        </div>
      </div>
      <div className="absolute -bottom-3 left-[44%] hidden w-48 rounded-card border border-brand-400 bg-white p-4 text-text shadow-xl md:block">
        <div className="flex justify-between text-[9px]">
          <strong className="text-brand-700">DP-04</strong>
          <span className="text-danger">● 검토 필요</span>
        </div>
        <p className="mt-2 text-xs font-bold">특정 옵션의 사전선택</p>
        <p className="mt-2 text-[9px] leading-4 text-muted">
          선택적 유료 서비스가 기본 선택되어 있습니다.
        </p>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-text">
      <section className="subtle-grid overflow-hidden bg-brand-950 text-white">
        <header className="page-container flex items-center justify-between py-6">
          <Brand />
          <nav className="hidden items-center gap-12 text-sm text-white/80 lg:flex">
            <a href="#product">제품 소개</a>
            <a href="#standards">검토 기준</a>
            <a href="#process">작동 방식</a>
            <a href="#cases">고객 사례</a>
          </nav>
          <Button asChild>
            <Link to="/app/overview">진단 시작하기</Link>
          </Button>
        </header>
        <main className="page-container grid items-center gap-16 py-[74px] lg:grid-cols-[0.85fr_1.15fr] lg:py-[90px]">
          <div>
            <p className="mb-6 text-sm font-semibold uppercase tracking-widest text-brand-400">
              금융 UX 사전 점검
            </p>
            <h1 className="max-w-2xl text-4xl font-bold leading-[1.25] tracking-tight sm:text-5xl xl:text-6xl">
              금융상품 UX를
              <br />
              <span className="text-brand-400">더 명확한 기준으로</span>
              <br />
              검토하세요.
            </h1>
            <p className="mt-7 max-w-lg text-base leading-8 text-white/70">
              금융위원회 온라인 금융상품 판매 관련 다크패턴 가이드라인을 기반으로 AI가 금융상품
              화면과 이용 흐름을 분석합니다.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button asChild variant="secondary">
                <Link to="/app/overview">
                  진단 시작하기 <ArrowRight size={17} />
                </Link>
              </Button>
              <a
                className="flex items-center gap-2 px-3 py-3 text-sm font-semibold"
                href="#product"
              >
                서비스 살펴보기 <ArrowRight size={16} />
              </a>
            </div>
            <p className="mt-10 flex items-center gap-2 text-xs text-white/60">
              <ShieldCheck className="text-brand-400" size={18} /> 금융권 보안 기준을 준수하여
              안전하게 데이터를 처리합니다.
            </p>
          </div>
          <ProductMockup />
        </main>
      </section>

      <section className="page-container py-20 text-center" id="product">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">
          DarkAudit이 필요한 이유
        </p>
        <h2 className="mt-4 text-3xl font-bold leading-tight">
          작은 UI 차이가
          <br />
          금융소비자의 선택을 바꿀 수 있습니다.
        </h2>
        <div className="mt-12 grid gap-5 text-left lg:grid-cols-3">
          {patterns.map((pattern) => (
            <Card
              className="grid min-h-52 grid-cols-[1fr_0.9fr] items-center gap-5 p-6"
              key={pattern.number}
            >
              <div>
                <p className="text-xs font-bold text-brand-600">{pattern.number}</p>
                <h3 className="mt-3 font-bold">{pattern.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted">{pattern.description}</p>
              </div>
              <div>{pattern.preview}</div>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-gradient-to-r from-brand-50 to-white py-20" id="standards">
        <div className="page-container grid items-center gap-12 lg:grid-cols-[0.9fr_0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600">
              공신력 있는 검토 기준
            </p>
            <h2 className="mt-4 text-3xl font-bold leading-tight">
              금융위원회 공식 기준을
              <br />
              구조화하여 검토합니다.
            </h2>
            <p className="mt-5 text-sm leading-7 text-muted">
              온라인 금융상품 판매 관련 다크패턴 가이드라인의 4개 범주와 15개 유형을 기반으로 검토를
              제공합니다.
            </p>
            <Link
              className="mt-6 inline-block rounded-control bg-brand-100 px-4 py-3 text-xs font-semibold text-brand-700"
              to="/app/guidelines"
            >
              전체 검토 기준 보기 →
            </Link>
          </div>
          <Card className="grid grid-cols-2 divide-x divide-border p-8 text-center">
            <div>
              <p className="text-5xl font-light text-brand-600">04</p>
              <p className="mt-3 text-sm font-semibold">범주</p>
            </div>
            <div>
              <p className="text-5xl font-light text-brand-600">15</p>
              <p className="mt-3 text-sm font-semibold">유형</p>
            </div>
            <p className="col-span-2 mt-8 border-t border-border pt-6 text-[10px] text-muted">
              금융위원회 「온라인 금융상품 판매 관련 다크패턴 가이드라인」 기반
            </p>
          </Card>
          <div className="grid gap-8 sm:grid-cols-2">
            {[
              [WalletCards, "오도형", "잘못된 정보 제공으로 소비자를 오인시키는 유형"],
              [Building2, "방해형", "소비자의 합리적 의사결정을 방해하는 유형"],
              [HeartHandshake, "압박형", "심리적 압박을 통해 선택을 유도하는 유형"],
              [ScanSearch, "편취유도형", "추가 비용이나 정보를 은폐·유도하는 유형"],
            ].map(([Icon, title, copy]) => {
              const ItemIcon = Icon as typeof WalletCards;
              return (
                <div className="flex gap-4" key={title as string}>
                  <ItemIcon className="shrink-0 text-brand-600" size={29} />
                  <div>
                    <h3 className="text-sm font-bold">{title as string}</h3>
                    <p className="mt-2 text-xs leading-5 text-muted">{copy as string}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="page-container py-20 text-center" id="process">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">이용 방법</p>
        <h2 className="mt-3 text-3xl font-bold">3단계로 금융 UX를 검토합니다.</h2>
        <div className="mt-14 grid gap-8 text-left md:grid-cols-3">
          {[
            [
              Upload,
              "01",
              "가입 흐름 등록",
              "금융상품의 가입 및 이용 화면을 실제 사용 순서대로 등록합니다.",
            ],
            [
              ScanSearch,
              "02",
              "AI 기반 분석",
              "UI 요소, 문구, 선택 상태와 화면 간 변화를 함께 분석합니다.",
            ],
            [
              FileCheck2,
              "03",
              "검토 및 개선",
              "관련 기준과 근거를 확인하고 수정 후 다시 검토할 수 있습니다.",
            ],
          ].map(([Icon, number, title, copy]) => {
            const StepIcon = Icon as typeof Upload;
            return (
              <div className="flex items-start gap-5" key={number as string}>
                <div className="relative flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                  <StepIcon size={27} />
                  <span className="absolute -left-1 -top-2 flex size-7 items-center justify-center rounded-full bg-brand-700 text-[10px] text-white">
                    {number as string}
                  </span>
                </div>
                <div>
                  <h3 className="font-bold">{title as string}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">{copy as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="subtle-grid bg-brand-950 py-12 text-center text-white" id="cases">
        <h2 className="text-2xl font-bold">금융상품 UX 검토를 시작하세요.</h2>
        <p className="mt-3 text-sm text-white/65">
          출시 전 검토로 소비자에게 더 명확하고 신뢰할 수 있는 경험을 제공할 수 있습니다.
        </p>
        <Button asChild className="mt-6">
          <Link to="/app/overview">
            진단 시작하기 <ArrowRight size={17} />
          </Link>
        </Button>
      </section>
    </div>
  );
}
