import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Expand,
  FileText,
  MonitorSmartphone,
  MoreVertical,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AuditReport } from "@/features/audit-report/AuditReport";
import type { AuditDto, AuditScreenDto, FindingDto } from "@/entities/audit/types";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { ScreenCanvas } from "@/features/finding-review/ScreenCanvas";
import { FindingDecisionNote } from "@/features/finding-review/FindingDecisionNote";
import { useFindingStatus } from "@/features/finding-review/useFindingStatus";
import { cn } from "@/lib/cn";

import "./overview.css";

const auditStatusPresentation: Record<
  AuditDto["status"],
  { label: string; variant: "neutral" | "progress" | "success" | "danger" }
> = {
  draft: { label: "준비 중", variant: "neutral" },
  queued: { label: "대기 중", variant: "progress" },
  analyzing: { label: "진단 중", variant: "progress" },
  completed: { label: "완료", variant: "success" },
  failed: { label: "실패", variant: "danger" },
};

type FindingFilter = "all" | "needs-review" | "resolved";
const findingFilters: { value: FindingFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "needs-review", label: "검토 필요" },
  { value: "resolved", label: "해결됨" },
];

function matchesFilter(finding: FindingDto, filter: FindingFilter) {
  return (
    filter === "all" ||
    (filter === "resolved" ? finding.status === "resolved" : finding.status !== "resolved")
  );
}

function FindingBadges({ finding }: { finding: FindingDto }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant={
          finding.severity === "HIGH"
            ? "danger"
            : finding.severity === "REVIEW"
              ? "warning"
              : "neutral"
        }
      >
        심각도 {{ HIGH: "높음", REVIEW: "검토 필요", LOW: "낮음" }[finding.severity]}
      </Badge>
      <Badge
        variant={
          finding.status === "resolved"
            ? "success"
            : finding.status === "reviewing"
              ? "progress"
              : "neutral"
        }
      >
        {{ open: "미검토", reviewing: "검토 중", resolved: "해결됨" }[finding.status]}
      </Badge>
    </div>
  );
}

function FlowOverview({
  screens,
  selectedScreenId,
  onSelect,
  onShowAll,
}: {
  screens: AuditScreenDto[];
  selectedScreenId: string;
  onSelect: (screenId: string) => void;
  onShowAll: () => void;
}) {
  return (
    <Card className="min-w-0 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">가입 흐름 요약</h2>
        <button
          className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-xs font-semibold text-brand-700"
          onClick={onShowAll}
        >
          전체 흐름 보기 <ArrowRight size={13} />
        </button>
      </div>
      <div
        className="mt-5 flex gap-3 overflow-x-auto py-2"
        role="group"
        aria-label="가입 흐름 단계"
      >
        {screens.map((screen, index) => (
          <button
            className={cn(
              "relative min-w-28 flex-1 rounded-control p-3 text-center transition-colors hover:bg-brand-50",
              selectedScreenId === screen.id && "bg-brand-50 ring-2 ring-inset ring-brand-500",
            )}
            key={screen.id}
            aria-label={`${index + 1}단계 ${screen.flowStep}, 문제 ${screen.findingCount}건`}
            aria-pressed={selectedScreenId === screen.id}
            onClick={() => onSelect(screen.id)}
          >
            {index < screens.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[60%] top-7 h-px w-[80%] border-t border-dashed border-muted/40"
              />
            )}
            <div className="relative mx-auto flex size-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold tabular-nums text-white">
              {index + 1}
            </div>
            <span
              className={cn(
                "mx-auto mt-2 flex min-h-6 w-fit items-center justify-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold tabular-nums",
                screen.findingCount > 0
                  ? "bg-danger text-white"
                  : "bg-background text-muted ring-1 ring-inset ring-border",
              )}
            >
              문제 {screen.findingCount}건
            </span>
            <div className="mx-auto mt-3 flex h-24 w-16 items-center justify-center overflow-hidden rounded border border-border bg-white shadow-sm">
              <img
                alt={`${screen.flowStep} 캡처 화면`}
                className="max-h-full max-w-full object-contain"
                loading="lazy"
                src={screen.imageUrl}
              />
            </div>
            <p className="mt-3 truncate text-xs font-semibold">{screen.flowStep}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ScreenPreview({
  screen,
  finding,
  findings,
  onSelect,
  focusRequest,
}: {
  screen: AuditScreenDto;
  finding?: FindingDto;
  findings: { finding: FindingDto; number: number }[];
  onSelect: (finding: FindingDto) => void;
  focusRequest: number;
}) {
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panOriginRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  function startPanning(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    panOriginRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    setIsPanning(true);
  }

  function panPreview(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = panOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = origin.scrollLeft - (event.clientX - origin.x);
    event.currentTarget.scrollTop = origin.scrollTop - (event.clientY - origin.y);
  }

  function stopPanning(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = panOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panOriginRef.current = null;
    setIsPanning(false);
  }

  return (
    <div id="finding-screen-preview" className="min-w-0" ref={previewRef}>
      <Card className="relative h-full min-h-[520px] overflow-hidden">
        <h2 className="flex min-h-16 items-center border-b border-border px-6 py-4 text-base font-semibold">
          화면 미리보기
        </h2>
        <div
          aria-label="화면 미리보기 이동 영역"
          data-testid="screen-preview-viewport"
          className={cn(
            "scrollbar-hidden absolute inset-x-0 bottom-12 top-16 touch-none select-none overflow-auto bg-background p-5",
            isPanning ? "cursor-grabbing" : "cursor-grab",
          )}
          onPointerCancel={stopPanning}
          onPointerDown={startPanning}
          onPointerMove={panPreview}
          onPointerUp={stopPanning}
          ref={viewportRef}
          role="region"
          tabIndex={0}
        >
          {/*
          h-full 이 필요하다. 퍼센트 높이는 부모 높이가 확정돼야 계산되는데, 이
          래퍼가 height:auto 면 안쪽 이미지의 max-h-full 이 무시돼 원본 크기로
          렌더링되고 미리보기 영역을 넘쳐 잘린다.
        */}
          <div
            className="flex min-h-full min-w-full items-center justify-center"
            data-testid="screen-preview-scroll-area"
            style={
              scale > 1
                ? { height: `${scale * 100}%`, width: `${scale * 100}%` }
                : { height: "100%", width: "100%" }
            }
          >
            <div
              className="relative flex h-full w-full items-center justify-center transition-transform"
              style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
            >
              <ScreenCanvas
                alt={`${screen.flowStep} 캡처 화면 미리보기`}
                className="max-h-full max-w-full rounded border border-border bg-white object-contain shadow-sm"
                finding={finding}
                findings={findings}
                onSelect={onSelect}
                viewportRef={viewportRef}
                focusRequest={focusRequest}
                screen={screen}
              />
            </div>
          </div>
        </div>
        <div className="absolute right-4 top-20 overflow-hidden rounded-control border border-border bg-white shadow-sm">
          <button
            aria-label="확대"
            className="flex h-10 w-9 items-center justify-center border-b border-border"
            onClick={() => setScale((value) => Math.min(2, value + 0.2))}
          >
            <ZoomIn size={15} />
          </button>
          <button
            aria-label="축소"
            className="flex h-10 w-9 items-center justify-center border-b border-border"
            onClick={() => setScale((value) => Math.max(0.5, value - 0.2))}
          >
            <ZoomOut size={15} />
          </button>
          <button
            aria-label="배율 초기화"
            className="flex h-10 w-9 items-center justify-center border-b border-border"
            onClick={() => {
              setScale(1);
              viewportRef.current?.scrollTo?.({ left: 0, top: 0 });
            }}
          >
            <RotateCcw size={15} />
          </button>
          <button
            aria-label="전체 화면"
            className="flex h-10 w-9 items-center justify-center"
            onClick={async () => {
              if (document.fullscreenElement) await document.exitFullscreen();
              else await previewRef.current?.requestFullscreen();
            }}
          >
            <Expand size={15} />
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex h-12 items-center border-t border-border bg-surface px-4 text-xs leading-5 text-muted">
          번호를 누르면 설명 · 실선: 탐지 · 점선: 관련 영역
        </div>
      </Card>
    </div>
  );
}

function FindingDetails({
  finding,
  number,
  position,
  total,
  onStep,
  onResolved,
  hasNextReview,
  emptyMessage,
}: {
  finding?: FindingDto;
  number: number;
  position: number;
  total: number;
  onStep: (delta: number) => void;
  onResolved: () => void;
  hasNextReview: boolean;
  emptyMessage: string;
}) {
  const findingStatus = useFindingStatus();
  const [showMetadata, setShowMetadata] = useState(false);

  return (
    <Card id="finding-detail-panel" className="min-w-0 overflow-hidden">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 id="finding-detail-heading" tabIndex={-1} className="text-base font-semibold">
          탐지 항목 상세
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <button
            aria-label="이전 탐지 항목"
            className="disabled:opacity-30"
            disabled={total < 2}
            onClick={() => onStep(-1)}
            type="button"
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {total ? position + 1 : 0} / {total}
          </span>
          <button
            aria-label="다음 탐지 항목"
            className="disabled:opacity-30"
            disabled={total < 2}
            onClick={() => onStep(1)}
            type="button"
          >
            <ChevronRight size={15} />
          </button>
          <button aria-label="탐지 메타데이터" onClick={() => setShowMetadata((value) => !value)}>
            <MoreVertical size={16} />
          </button>
        </div>
      </div>
      {finding ? (
        <div className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-base font-semibold text-brand-700">
              <span
                aria-label={`항목 ${number}번`}
                className="flex size-7 items-center justify-center rounded bg-brand-600 text-sm font-bold text-white"
              >
                {number}
              </span>
              {finding.ruleId}
            </p>
            <FindingBadges finding={finding} />
          </div>
          <h3 className="font-display mt-3 text-2xl font-bold">{finding.title}</h3>
          <p className="mt-3 text-sm leading-6 text-muted">{finding.description}</p>
          <dl className="mt-6 divide-y divide-border border-y border-border text-sm">
            <div className="grid grid-cols-2 py-3">
              <dt className="text-muted">대상 요소</dt>
              <dd>{finding.element}</dd>
            </div>
            <div className="grid grid-cols-2 py-3">
              <dt className="text-muted">기본 상태</dt>
              <dd className="font-semibold text-danger">{finding.defaultState ?? "-"}</dd>
            </div>
            <div className="grid grid-cols-2 py-3">
              <dt className="text-muted">추가 비용</dt>
              <dd className="font-semibold text-danger">{finding.costImpact ?? "-"}</dd>
            </div>
          </dl>
          <div className="mt-6 flex gap-4 rounded-card border border-border p-5">
            <FileText className="shrink-0 text-brand-600" size={25} />
            <div>
              <p className="text-base font-semibold">금융위원회 금융소비자 보호 가이드라인</p>
              <p className="mt-2 text-xs leading-6 text-muted">{finding.guideline}</p>
            </div>
          </div>
          <div className="mt-5 border-l-2 border-brand-600 bg-brand-50 p-5 text-sm leading-6 text-brand-950">
            <h4 className="font-bold">개선 권고안</h4>
            <p className="mt-2">{finding.recommendation}</p>
          </div>
          <FindingDecisionNote finding={finding} />
          {showMetadata && (
            <div className="mt-3 rounded-card border border-border p-4 text-xs text-muted">
              신뢰도 {Math.round(finding.confidence * 100)}%
            </div>
          )}
          <button
            className={cn(
              "mt-3 flex w-full items-center justify-center gap-2 rounded-control py-3 text-sm font-semibold text-white disabled:opacity-50",
              finding.status === "resolved" ? "bg-muted" : "bg-brand-600",
            )}
            disabled={findingStatus.isPending}
            onClick={() =>
              findingStatus.mutate(
                {
                  findingId: finding.id,
                  status: finding.status === "resolved" ? "reviewing" : "resolved",
                },
                {
                  onSuccess: () => {
                    if (finding.status !== "resolved") onResolved();
                  },
                },
              )
            }
          >
            {findingStatus.isPending ? (
              <RefreshCw className="animate-spin" size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            {findingStatus.isPending
              ? "상태 저장 중…"
              : finding.status === "resolved"
                ? "검토 상태로 되돌리기"
                : hasNextReview
                  ? "해결하고 다음 미검토 항목"
                  : "해결됨으로 표시"}
          </button>
          {findingStatus.isError && findingStatus.variables?.findingId === finding.id && (
            <p role="alert" className="mt-2 text-sm text-danger">
              상태를 저장하지 못했습니다. 다시 시도해주세요.
            </p>
          )}
        </div>
      ) : (
        <div className="flex min-h-96 flex-col items-center justify-center p-8 text-center">
          <FileText className="text-muted" size={34} />
          <h3 className="mt-4 font-bold">{emptyMessage}</h3>
          <p className="mt-2 text-sm text-muted">다른 필터나 화면을 선택해 확인할 수 있습니다.</p>
        </div>
      )}
    </Card>
  );
}

function FindingsList({
  findings,
  selectedFindingId,
  onSelect,
  filter,
  onFilter,
  allFindings,
  onNextReview,
  hasNextReview,
}: {
  findings: FindingDto[];
  selectedFindingId?: string;
  onSelect: (finding: FindingDto) => void;
  filter: FindingFilter;
  onFilter: (filter: FindingFilter) => void;
  allFindings: FindingDto[];
  onNextReview: () => void;
  hasNextReview: boolean;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold">점검 항목</h2>
        <span className="text-xs tabular-nums text-muted">{findings.length}개</span>
      </div>
      <div className="space-y-3 border-b border-border p-4">
        <div role="group" aria-label="점검 항목 필터" className="flex flex-wrap gap-2">
          {findingFilters.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
              className={cn(
                "rounded-control border px-2.5 py-2 text-xs font-semibold",
                filter === value
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-border text-muted hover:bg-brand-50",
              )}
            >
              {label}{" "}
              <span className="tabular-nums">
                {allFindings.filter((item) => matchesFilter(item, value)).length}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted">
          검토 필요에는 미검토·검토 중 항목이 포함됩니다.
        </p>
        <Button
          variant="outline"
          className="w-full px-3 py-2 text-xs"
          disabled={!hasNextReview}
          onClick={onNextReview}
        >
          다음 미검토 항목 <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
      <nav aria-label="점검 항목" className="max-h-[640px] divide-y divide-border overflow-y-auto">
        {findings.map((finding) => (
          <button
            aria-current={selectedFindingId === finding.id ? "true" : undefined}
            aria-controls="finding-review-detail"
            key={finding.id}
            onClick={() => onSelect(finding)}
            className={cn(
              "w-full border-l-2 border-transparent p-5 text-left transition-colors hover:bg-brand-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
              selectedFindingId === finding.id && "border-brand-600 bg-brand-50",
            )}
          >
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-bold text-brand-700">
                <span className="flex size-6 items-center justify-center rounded bg-brand-600 text-white">
                  {allFindings.findIndex((item) => item.id === finding.id) + 1}
                </span>
                {finding.ruleId}
              </p>
              <FindingBadges finding={finding} />
            </div>
            <div className="mt-3 min-w-0">
              <h3 className="break-keep text-sm font-semibold leading-6 [overflow-wrap:anywhere]">
                {finding.title}
              </h3>
              <p className="mt-1 line-clamp-2 break-keep text-xs leading-5 text-muted [overflow-wrap:anywhere]">
                {finding.description}
              </p>
            </div>
          </button>
        ))}
        {!findings.length && (
          <p className="p-4 text-sm leading-6 text-muted" role="status">
            {filter === "resolved"
              ? "해결된 항목이 없습니다."
              : filter === "needs-review"
                ? "검토가 필요한 항목이 없습니다."
                : "탐지된 항목이 없습니다."}
          </p>
        )}
      </nav>
    </Card>
  );
}

function DashboardLoading() {
  return (
    <div
      aria-label="상세 결과 불러오는 중"
      className="mx-auto max-w-[1500px] animate-pulse"
      role="status"
    >
      <div className="h-8 w-32 rounded bg-black/10" />
      <div className="mt-6 h-44 rounded-card bg-brand-100" />
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <div className="h-56 rounded-card bg-black/5" />
          <div className="h-96 rounded-card bg-black/5" />
        </div>
        <div className="h-[620px] rounded-card bg-black/5" />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { data, isPending, isError, error, refetch } = useDashboardSummary();
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusRequest, setFocusRequest] = useState(0);
  const selectionSnapshot = searchParams.toString();
  const latestSelection = useRef(selectionSnapshot);
  useEffect(() => {
    latestSelection.current = selectionSnapshot;
  }, [selectionSnapshot]);
  const [showFlow, setShowFlow] = useState(false);
  const flowBackdropPointerDown = useRef(false);
  const [showReport, setShowReport] = useState(false);
  const reportButtonRef = useRef<HTMLButtonElement>(null);

  if (isPending) {
    return <DashboardLoading />;
  }

  if (isError) {
    return (
      <Card className="mx-auto mt-20 max-w-lg p-10 text-center">
        <CircleAlert className="mx-auto text-danger" size={36} />
        <h1 className="mt-5 text-xl font-bold">상세 결과를 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm text-muted">
          {error instanceof Error ? error.message : "잠시 후 다시 시도해주세요."}
        </p>
        <button
          className="mx-auto mt-6 flex items-center gap-2 rounded-control bg-brand-600 px-5 py-3 text-sm font-semibold text-white"
          onClick={() => refetch()}
        >
          <RefreshCw size={15} /> 다시 시도
        </button>
      </Card>
    );
  }

  if (!data.audits.length) {
    return (
      <Card className="mx-auto mt-20 max-w-lg p-10 text-center">
        <ShieldCheck className="mx-auto text-brand-500" size={38} />
        <h1 className="mt-5 text-xl font-bold">등록된 진단이 없습니다</h1>
        <p className="mt-2 text-sm text-muted">
          첫 금융상품 가입 흐름을 등록하고 UX 검토를 시작하세요.
        </p>
        <Link
          className="mx-auto mt-6 inline-flex rounded-control bg-brand-600 px-5 py-3 text-sm font-semibold text-white"
          to="/app/audits/new"
        >
          새 진단 시작하기
        </Link>
      </Card>
    );
  }

  const audit =
    data.audits.find((item) => item.id === searchParams.get("audit")) ??
    data.audits.find((item) => item.id === data.activeAuditId) ??
    data.audits[0]!;
  if (!audit.screens.length) {
    return (
      <Card className="mx-auto mt-20 max-w-lg p-10 text-center">
        <CircleAlert className="mx-auto text-warning" size={36} />
        <h1 className="mt-5 text-xl font-bold">캡처된 화면이 없습니다</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {audit.status === "failed"
            ? "자동 캡처 또는 AI 분석이 실패했습니다. 새 진단에서 URL과 서버 설정을 확인해주세요."
            : "화면 업로드나 URL 캡처가 아직 시작되지 않은 진단입니다."}
        </p>
        <Link
          className="mx-auto mt-6 inline-flex rounded-control bg-brand-600 px-5 py-3 text-sm font-semibold text-white"
          to="/app/audits/new"
        >
          새 진단 시작하기
        </Link>
      </Card>
    );
  }
  const filterParam = searchParams.get("filter");
  const filter: FindingFilter =
    filterParam === "needs-review" || filterParam === "resolved" ? filterParam : "all";
  const filteredFindings = audit.findings.filter((item) => matchesFilter(item, filter));
  const requestedScreen = searchParams.get("screen");
  const requestedFinding = searchParams.get("finding");
  const selectedFinding = filteredFindings.find((item) => item.id === requestedFinding);
  const finding =
    selectedFinding ??
    (requestedScreen && !requestedFinding
      ? filteredFindings.find((item) => item.screenIds.includes(requestedScreen))
      : filteredFindings[0]);
  // 화면을 명시하지 않았다면 선택된 항목이 있는 화면을 띄운다. 둘을 각각 고르면
  // 첫 진입에서 "1번 화면 + 2번 화면의 탐지 항목"처럼 어긋나 위치 강조가 안 보인다.
  const screen =
    (selectedFinding || !requestedFinding
      ? audit.screens.find((item) => item.id === requestedScreen)
      : undefined) ??
    audit.screens.find((item) => item.id === finding?.bbox?.screenId) ??
    audit.screens.find((item) => item.id === finding?.screenIds[0]) ??
    audit.screens[0]!;
  const findingPosition = finding
    ? filteredFindings.findIndex((item) => item.id === finding.id)
    : -1;
  const originalPosition = audit.findings.findIndex((item) => item.id === finding?.id);
  const reviewOrder = [
    ...audit.findings.slice(originalPosition + 1),
    ...audit.findings.slice(0, originalPosition + 1),
  ];
  const nextReview = reviewOrder.find(
    (item) => item.id !== finding?.id && item.status !== "resolved",
  );
  const emptyMessage = !audit.findings.length
    ? "탐지된 항목이 없습니다"
    : !filteredFindings.length
      ? filter === "resolved"
        ? "해결된 항목이 없습니다"
        : "검토가 필요한 항목이 없습니다"
      : "이 화면에 해당하는 점검 항목이 없습니다";
  const needsReview = audit.findings.filter((item) => item.status !== "resolved").length;
  const resolved = audit.findings.filter((item) => item.status === "resolved").length;
  const auditStatus = auditStatusPresentation[audit.status];
  const metrics = [
    {
      filter: "all" as const,
      label: "탐지된 항목",
      value: audit.findings.length,
      action: "전체 보기",
      color: "text-brand-600",
    },
    {
      filter: "needs-review" as const,
      label: "검토 필요",
      value: needsReview,
      action: "지금 검토",
      color: "text-warning",
    },
    {
      filter: "resolved" as const,
      label: "해결됨",
      value: resolved,
      action: "해결 항목 보기",
      color: "text-success",
    },
  ];

  function selectScreen(screenId: string) {
    const relatedFinding = filteredFindings.find((item) => item.screenIds.includes(screenId));
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set("audit", audit.id);
      params.set("screen", screenId);
      if (relatedFinding) params.set("finding", relatedFinding.id);
      else params.delete("finding");
      return params;
    });
  }

  function findingParams(
    current: URLSearchParams,
    nextFinding: FindingDto | undefined,
    nextFilter: FindingFilter,
  ) {
    const params = new URLSearchParams(current);
    params.set("audit", audit.id);
    params.set("filter", nextFilter);
    if (nextFinding) {
      params.set("finding", nextFinding.id);
      params.set("screen", nextFinding.bbox?.screenId ?? nextFinding.screenIds[0] ?? screen.id);
    } else {
      params.delete("finding");
      params.delete("screen");
    }
    return params;
  }

  function selectFinding(nextFinding: FindingDto) {
    setFocusRequest((value) => value + 1);
    setSearchParams((current) => findingParams(current, nextFinding, filter));
  }

  function selectListFinding(nextFinding: FindingDto) {
    selectFinding(nextFinding);
    requestAnimationFrame(() => {
      document.getElementById("finding-screen-preview")?.scrollIntoView?.({ block: "nearest" });
    });
  }

  function selectImageFinding(nextFinding: FindingDto) {
    setSearchParams((current) => {
      const params = findingParams(current, nextFinding, filter);
      params.set("screen", screen.id);
      return params;
    });
    requestAnimationFrame(() => {
      const heading = document.getElementById("finding-detail-heading");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({ block: "nearest" });
    });
  }

  function selectFilter(nextFilter: FindingFilter) {
    const next =
      finding && matchesFilter(finding, nextFilter)
        ? finding
        : audit.findings.find((item) => matchesFilter(item, nextFilter));
    setSearchParams((current) => findingParams(current, next, nextFilter));
  }

  function selectNextReview() {
    if (nextReview)
      setSearchParams((current) => findingParams(current, nextReview, "needs-review"));
  }

  function afterResolved() {
    // Do not move the user if they navigated elsewhere while the save was pending.
    if (latestSelection.current !== selectionSnapshot) return;
    setSearchParams((current) => findingParams(current, nextReview, "needs-review"));
  }

  function stepFinding(delta: number) {
    if (filteredFindings.length < 2) return;
    const total = filteredFindings.length;
    const nextIndex =
      findingPosition < 0 ? (delta > 0 ? 0 : total - 1) : (findingPosition + delta + total) % total;
    const next = filteredFindings[nextIndex]!;
    selectFinding(next);
  }

  return (
    <div className="overview-page mx-auto max-w-[1500px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-600 pb-6">
        <div>
          <Link
            className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
            to="/app/audits"
          >
            <ChevronLeft size={16} />
            진단 관리
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight">진단 결과 상세</h1>
        </div>
        <Button ref={reportButtonRef} variant="outline" onClick={() => setShowReport(true)}>
          <FileText size={16} aria-hidden="true" /> PDF 보고서 출력
        </Button>
      </div>
      {showReport && (
        <AuditReport
          audit={audit}
          onClose={() => {
            setShowReport(false);
            requestAnimationFrame(() => reportButtonRef.current?.focus());
          }}
        />
      )}
      {audit.analysisSummary?.supportedRules && (
        <section aria-label="분석 범위" className="rounded-card border border-border bg-white p-6">
          <h2 className="font-semibold">
            {audit.analysisSummary.complete
              ? "수집한 화면의 규칙 검사 완료"
              : "검사 범위와 추가 확인 사항"}
          </h2>
          <p className="mt-2 text-sm text-muted">
            지원 규칙 {audit.analysisSummary.supportedRules.length}개 · 분석 화면{" "}
            {audit.analysisSummary.analyzedScreenCount ?? 0}개. 전체 15개 유형 중 지원 규칙만
            검사하며, 탐지 0건이 미수집 화면의 안전을 의미하지는 않습니다.
          </p>
          {!!audit.analysisSummary.limitations?.length && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {audit.analysisSummary.limitations.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {audit.analysisSummary.ruleAssessments?.map((assessment) => (
              <span
                className="rounded border border-border px-2 py-1 text-xs"
                key={assessment.ruleId}
              >
                {assessment.ruleId}:{" "}
                {
                  {
                    detected: "탐지됨",
                    not_detected: "관찰 범위 내 미탐지",
                    insufficient_evidence: "근거 부족",
                    not_supported: "검사하지 않음",
                  }[assessment.status]
                }
              </span>
            ))}
          </div>
        </section>
      )}
      <section aria-label="진단 요약">
        <Card className="flex min-w-0 flex-col p-6 sm:p-8">
          <Badge className="self-start" variant={auditStatus.variant}>
            {auditStatus.label}
          </Badge>
          <h2 className="font-display mt-4 text-2xl font-bold sm:text-3xl">{audit.name}</h2>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs leading-5 text-muted">
            <span className="flex items-center gap-2">
              <Smartphone size={15} />
              {
                { "mobile-web": "모바일 웹", "desktop-web": "데스크톱 웹", app: "앱" }[
                  audit.platform
                ]
              }
            </span>
            <span className="flex items-center gap-2">
              <MonitorSmartphone size={15} /> 화면 {audit.screens.length}개
            </span>
            <span className="flex items-center gap-2">
              <CalendarDays size={15} />{" "}
              {new Intl.DateTimeFormat("ko-KR", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(audit.updatedAt))}
            </span>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-border pt-5">
            {metrics.map(({ label, value, action, color, filter: metricFilter }) => (
              <button
                className={cn(
                  "inline-flex items-center gap-2 rounded px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 hover:bg-brand-50",
                  filter === metricFilter && "bg-brand-50 ring-1 ring-inset ring-brand-300",
                )}
                aria-label={`${label} ${value}건`}
                aria-pressed={filter === metricFilter}
                key={label}
                onClick={() => selectFilter(metricFilter)}
                title={action}
                type="button"
              >
                <span className="text-muted">{label}</span>
                <span className={cn("font-bold tabular-nums", color)}>{value}건</span>
              </button>
            ))}
          </div>
        </Card>
      </section>
      <FlowOverview
        screens={audit.screens}
        selectedScreenId={screen.id}
        onSelect={selectScreen}
        onShowAll={() => setShowFlow(true)}
      />
      <div className="overview-review">
        <FindingsList
          findings={filteredFindings}
          allFindings={audit.findings}
          filter={filter}
          onFilter={selectFilter}
          onNextReview={selectNextReview}
          hasNextReview={Boolean(nextReview)}
          selectedFindingId={finding?.id}
          onSelect={selectListFinding}
        />
        <section
          id="finding-review-detail"
          aria-label="선택한 항목 검토"
          className="overview-detail"
        >
          <ScreenPreview
            key={screen.id}
            finding={finding}
            screen={screen}
            findings={audit.findings.flatMap((item, index) =>
              matchesFilter(item, filter) ? [{ finding: item, number: index + 1 }] : [],
            )}
            onSelect={selectImageFinding}
            focusRequest={focusRequest}
          />
          <FindingDetails
            finding={finding}
            number={originalPosition + 1}
            onStep={stepFinding}
            position={findingPosition}
            total={filteredFindings.length}
            onResolved={afterResolved}
            hasNextReview={Boolean(nextReview)}
            emptyMessage={emptyMessage}
          />
        </section>
      </div>
      {showFlow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="전체 가입 흐름"
          onPointerDown={(event) => {
            flowBackdropPointerDown.current =
              event.button === 0 && event.target === event.currentTarget;
          }}
          onPointerCancel={() => {
            flowBackdropPointerDown.current = false;
          }}
          onClick={(event) => {
            const shouldClose =
              flowBackdropPointerDown.current && event.target === event.currentTarget;
            flowBackdropPointerDown.current = false;
            if (shouldClose) setShowFlow(false);
          }}
        >
          <Card className="max-h-[90vh] w-full max-w-5xl overflow-auto p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">전체 가입 흐름</h2>
              <button
                className="rounded-control border border-border px-4 py-2 text-sm"
                onClick={() => setShowFlow(false)}
              >
                닫기
              </button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {audit.screens.map((item) => (
                <button
                  className="rounded-card border border-border p-4 text-left hover:border-brand-500"
                  key={item.id}
                  onClick={() => {
                    selectScreen(item.id);
                    setShowFlow(false);
                  }}
                >
                  <img
                    alt={`${item.flowStep} 전체 흐름 화면`}
                    className="mx-auto h-64 max-w-full object-contain"
                    src={item.imageUrl}
                  />
                  <p className="mt-3 text-base font-semibold">
                    {item.order}. {item.flowStep}
                  </p>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
