import { ArrowRight, ChevronDown, ExternalLink, FileText } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/cn";
import { guidelineCategories } from "./guidelines";

const categoryHints = [
  "오해하게 만드는 선택",
  "포기하게 만드는 절차",
  "결정을 재촉하는 자극",
  "뒤늦게 드러나는 비용",
];

export function GuidelinesPage() {
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [openId, setOpenId] = useState<string | null>("DA-01");
  const navigationRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const category = guidelineCategories[categoryIndex]!;

  return (
    <div className="mx-auto max-w-5xl pb-8">
      <p className="text-xs font-semibold tracking-wide text-brand-600">검토 기준 · 15개 유형</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">금융 다크패턴 4개 범주</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        범주를 고르고, 궁금한 유형을 펼쳐 확인하세요.
      </p>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-8">
        <nav
          ref={navigationRef}
          aria-label="가이드라인 범주"
          className="sticky top-0 z-10 -mx-4 grid grid-cols-4 gap-1 border-b border-border bg-background px-4 py-3 sm:mx-0 sm:gap-2 sm:px-0 lg:top-6 lg:grid-cols-1 lg:border-0 lg:py-0"
        >
          {guidelineCategories.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={categoryIndex === index}
              aria-controls="guideline-category-content"
              onClick={() => {
                setCategoryIndex(index);
                setOpenId(item.types[0]!.id);
                requestAnimationFrame(() => {
                  const top = contentRef.current?.getBoundingClientRect().top;
                  const offset = window.matchMedia("(min-width: 1024px)").matches
                    ? 24
                    : (navigationRef.current?.getBoundingClientRect().bottom ?? 0) + 16;
                  if (top !== undefined && top < offset) {
                    window.scrollBy({ top: top - offset, behavior: "instant" });
                  }
                });
              }}
              className={cn(
                "min-w-0 rounded-lg border px-1 py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:px-3 lg:rounded-xl lg:p-4 lg:text-left",
                categoryIndex === index
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-border bg-surface text-text hover:border-brand-300 hover:bg-brand-50",
              )}
            >
              <span className="flex items-center justify-center gap-1 whitespace-nowrap text-xs font-bold sm:gap-2 sm:text-sm lg:justify-between">
                {item.title}
                <span className="hidden text-xs font-medium opacity-75 sm:inline">
                  {item.types.length}
                </span>
              </span>
              <span
                className={cn(
                  "mt-2 hidden text-xs leading-5 lg:block",
                  categoryIndex === index ? "text-white/80" : "text-muted",
                )}
              >
                {categoryHints[index]}
              </span>
            </button>
          ))}
        </nav>

        <section
          ref={contentRef}
          id="guideline-category-content"
          aria-labelledby="guideline-category-title"
          className="min-w-0"
        >
          <div className="mb-5">
            <h2 id="guideline-category-title" className="text-xl font-bold">
              {category.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">{category.description}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {category.types.map((type) => {
              const expanded = openId === type.id;
              return (
                <div key={type.id} className="border-b border-border last:border-b-0">
                  <h3>
                    <button
                      id={`${type.id}-trigger`}
                      aria-expanded={expanded}
                      aria-controls={`${type.id}-content`}
                      type="button"
                      onClick={() => setOpenId(expanded ? null : type.id)}
                      className="flex w-full items-center gap-3 px-5 py-5 text-left hover:bg-brand-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:gap-4 sm:px-6"
                    >
                      <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                        {type.id.slice(3)}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 break-keep text-base font-semibold leading-6",
                          expanded && "text-brand-700",
                        )}
                      >
                        {type.title}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        size={18}
                        className={cn(
                          "shrink-0 text-muted transition-transform",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>
                  </h3>
                  <div
                    id={`${type.id}-content`}
                    role="region"
                    aria-labelledby={`${type.id}-trigger`}
                    hidden={!expanded}
                    className="px-5 pb-6 sm:pl-14 sm:pr-6"
                  >
                    <p className="max-w-prose text-base leading-7 text-text">{type.description}</p>
                    <div className="mt-5 border-l-2 border-brand-400 pl-4">
                      <h4 className="text-sm font-semibold text-brand-700">화면에서 확인할 점</h4>
                      <p className="mt-2 max-w-prose text-sm leading-7 text-text">
                        {type.checkpoint}
                      </p>
                    </div>
                    {"note" in type && (
                      <p className="mt-4 text-sm leading-6 text-muted">{type.note}</p>
                    )}
                    <p className="mt-4 text-xs text-muted">진단 항목 {type.id}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-6 text-muted">
            DarkAudit이 정리한 검토용 요약입니다. 자동 검사 범위는 각 진단 결과에서 확인하세요.
          </p>
        </section>
      </div>

      <aside aria-label="공식 가이드라인 자료" className="mt-10 border-t border-border pt-6">
        <div className="flex items-start gap-3">
          <FileText size={20} aria-hidden="true" className="mt-1 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-xs text-muted">
              금융위원회 · <time dateTime="2025-12-26">2025. 12. 26.</time>
            </p>
            <h2 className="mt-2 text-sm font-semibold leading-6">
              온라인 금융상품 판매 관련 다크패턴 가이드라인 마련
            </h2>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3 text-sm font-medium text-brand-700">
              <a
                className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                href="https://www.fsc.go.kr/po010101/85942"
                target="_blank"
                rel="noopener noreferrer"
              >
                공식 게시글 <ExternalLink size={13} aria-hidden="true" />
                <span className="sr-only">(새 탭)</span>
              </a>
              {[
                { format: "HWP", fileNo: 3 },
                { format: "HWPX", fileNo: 4 },
              ].map(({ format, fileNo }) => (
                <a
                  key={format}
                  className="underline-offset-4 hover:underline"
                  href={`https://www.fsc.go.kr/comm/getFile?fileNo=${fileNo}&fileTy=ATTACH&srvcId=BBSTY1&upperNo=85942`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  원문 {format}
                  <span className="sr-only"> 다운로드 (새 탭)</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </aside>
      <Link
        className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
        to="/app/audits/new"
      >
        새 진단 시작 <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}
