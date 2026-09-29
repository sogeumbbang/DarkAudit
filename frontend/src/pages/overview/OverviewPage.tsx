import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ListFilter,
  X,
  FileText,
  MoreVertical,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AuditReport } from "@/features/audit-report/AuditReport";
import type { AuditDto, AuditScreenDto, FindingDto } from "@/entities/audit/types";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { ScreenPreview } from "./ScreenPreview";
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
    <aside className="map-screens" aria-label="가입 흐름 요약">
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-xs font-semibold">화면 {screens.length}</h2>
        <button
          aria-label="전체 흐름 보기"
          title="전체 흐름 보기"
          onClick={onShowAll}
          className="rounded p-1 text-muted hover:bg-brand-50"
        >
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="map-screen-list" role="group" aria-label="가입 흐름 단계">
        {screens.map((screen, index) => (
          <button
            key={screen.id}
            className={cn("map-screen", selectedScreenId === screen.id && "is-selected")}
            aria-label={`${index + 1}단계 ${screen.flowStep}, 문제 ${screen.findingCount}건`}
            aria-pressed={selectedScreenId === screen.id}
            onClick={() => onSelect(screen.id)}
          >
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-bold tabular-nums">{index + 1}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 tabular-nums",
                  screen.findingCount ? "bg-danger text-white" : "text-muted",
                )}
              >
                {screen.findingCount}건
              </span>
            </div>
            <img
              alt={`${screen.flowStep} 캡처 화면`}
              src={screen.imageUrl}
              loading="lazy"
              className="mx-auto h-24 max-w-full rounded-sm bg-white object-contain shadow-sm"
            />
            <p className="mt-2 truncate text-xs font-medium">{screen.flowStep}</p>
          </button>
        ))}
      </div>
    </aside>
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
  onClose,
}: {
  finding?: FindingDto;
  number: number;
  position: number;
  total: number;
  onStep: (delta: number) => void;
  onResolved: () => void;
  hasNextReview: boolean;
  emptyMessage: string;
  onClose: () => void;
}) {
  const findingStatus = useFindingStatus();
  const [showMetadata, setShowMetadata] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.("(max-width: 767px)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 767px)");
    const update = () => setMobile(media?.matches ?? false);
    media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const panel = document.getElementById("finding-detail-panel");
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !panel) return;
      const controls = [
        ...panel.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, textarea, summary, a[href]",
        ),
      ].filter((item) => item.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement?.id === "finding-detail-heading")
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [mobile]);
  useEffect(() => {
    const panel = document.getElementById("finding-detail-panel");
    if (panel) panel.scrollTop = 0;
    document.getElementById("finding-detail-heading")?.focus({ preventScroll: true });
    if (window.matchMedia?.("(max-width: 767px)").matches) {
      document.getElementById("finding-screen-preview")?.scrollIntoView?.({ block: "start" });
    }
  }, [finding?.id]);

  return (
    <Card
      id="finding-detail-panel"
      className="map-finding-panel"
      role={mobile ? "dialog" : undefined}
      aria-modal={mobile || undefined}
      aria-labelledby="finding-detail-heading"
    >
      <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-2 border-b border-border bg-white px-4 py-3">
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
          <button
            aria-label="상세 설명 닫기"
            onClick={onClose}
            className="rounded p-1 hover:bg-brand-50"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {finding ? (
        <div className="p-4">
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
          <h3 className="font-display mt-3 text-xl font-bold">{finding.title}</h3>
          <p className="mt-3 text-sm leading-6 text-muted">{finding.description}</p>
          <div className="mt-5 border-l-2 border-brand-600 bg-brand-50 p-5 text-sm leading-6 text-brand-950">
            <h4 className="font-bold">개선 권고안</h4>
            <p className="mt-2">{finding.recommendation}</p>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-muted">
              판단 근거 및 가이드라인
            </summary>
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
          </details>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-muted">
              수정 결정 기록
            </summary>
            <FindingDecisionNote finding={finding} />
          </details>
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
  allFindings,
  filter,
}: {
  findings: FindingDto[];
  selectedFindingId?: string;
  onSelect: (finding: FindingDto) => void;
  allFindings: FindingDto[];
  filter: FindingFilter;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold">점검 항목</h2>
        <span className="text-xs tabular-nums text-muted">{findings.length}개</span>
      </div>
      <nav aria-label="점검 항목" className="map-findings-list divide-y divide-border">
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
  const [showList, setShowList] = useState(searchParams.get("list") === "1");
  const [showFlow, setShowFlow] = useState(false);
  const flowBackdropPointerDown = useRef(false);
  const [showReport, setShowReport] = useState(false);
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  const detailOpen = Boolean(searchParams.get("finding") || searchParams.get("panel"));
  useEffect(() => {
    if (!detailOpen || showFlow || showReport) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("finding");
        next.delete("panel");
        return next;
      });
      document.getElementById("finding-screen-preview")?.focus();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [detailOpen, showFlow, showReport, setSearchParams]);

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
  const reviewOrder = !detailOpen
    ? audit.findings
    : [
        ...audit.findings.slice(originalPosition + 1),
        ...audit.findings.slice(0, originalPosition + 1),
      ];
  const nextReview = reviewOrder.find(
    (item) => (!detailOpen || item.id !== finding?.id) && item.status !== "resolved",
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
  function closeDetail() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("screen", screen.id);
      next.delete("finding");
      next.delete("panel");
      return next;
    });
    requestAnimationFrame(() => document.getElementById("finding-screen-preview")?.focus());
  }

  function selectScreen(screenId: string) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set("audit", audit.id);
      params.set("screen", screenId);
      params.delete("finding");
      params.delete("panel");
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
    params.set("panel", "1");
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
    setFocusRequest((value) => value + 1);
    setSearchParams((current) => {
      const params = findingParams(current, nextFinding, filter);
      params.set("screen", screen.id);
      return params;
    });
    requestAnimationFrame(() => {
      const heading = document.getElementById("finding-detail-heading");
      heading?.focus({ preventScroll: true });
      if (window.matchMedia?.("(max-width: 767px)").matches) {
        document.getElementById("finding-screen-preview")?.scrollIntoView?.({ block: "start" });
      }
    });
  }

  function selectFilter(nextFilter: FindingFilter) {
    const next =
      finding && matchesFilter(finding, nextFilter)
        ? finding
        : audit.findings.find((item) => matchesFilter(item, nextFilter));
    setSearchParams((current) => {
      const params = findingParams(current, next, nextFilter);
      if (!detailOpen) {
        params.delete("finding");
        params.delete("panel");
        params.set("screen", screen.id);
      }
      return params;
    });
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
    <div className={cn("overview-page mx-auto max-w-[1800px]", detailOpen && "map-detail-open")}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-brand-600"
            to="/app/audits"
          >
            <ChevronLeft size={14} />
            진단 관리
          </Link>
          <h1 className="sr-only">진단 결과 상세</h1>
          <div className="flex items-center gap-3">
            <Badge variant={auditStatus.variant}>{auditStatus.label}</Badge>
            <h2 className="font-display text-xl font-bold">{audit.name}</h2>
          </div>
        </div>
        <Button ref={reportButtonRef} variant="outline" onClick={() => setShowReport(true)}>
          <FileText size={16} aria-hidden="true" /> PDF 보고서 출력
        </Button>
      </header>
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
        <section aria-label="분석 범위">
          <details className="rounded-control border border-border bg-white px-4 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-muted">
              {audit.analysisSummary.complete
                ? "분석 범위 확인"
                : "일부 검사에 추가 확인이 필요합니다"}
            </summary>
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
          </details>
        </section>
      )}
      <section aria-label="진단 요약" className="map-toolbar">
        <div role="group" aria-label="점검 항목 필터" className="flex flex-wrap gap-1">
          {findingFilters.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              title={value === "needs-review" ? "미검토·검토 중 항목" : label}
              onClick={() => selectFilter(value)}
              className={cn(
                "rounded-control px-3 py-2 text-xs font-semibold",
                filter === value ? "bg-brand-600 text-white" : "text-muted hover:bg-brand-50",
              )}
            >
              {label}{" "}
              {value === "all"
                ? audit.findings.length
                : value === "needs-review"
                  ? needsReview
                  : resolved}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-xs font-semibold"
            aria-expanded={showList}
            aria-controls="finding-list-tray"
            onClick={() => setShowList((value) => !value)}
          >
            <ListFilter size={15} />
            문제 목록
          </button>
          <Button
            variant="outline"
            className="px-3 py-2 text-xs"
            disabled={!nextReview}
            onClick={selectNextReview}
          >
            다음 미검토 항목 <ArrowRight size={14} />
          </Button>
        </div>
      </section>
      {showList && (
        <div id="finding-list-tray">
          <FindingsList
            findings={filteredFindings}
            allFindings={audit.findings}
            filter={filter}
            selectedFindingId={detailOpen ? finding?.id : undefined}
            onSelect={selectListFinding}
          />
        </div>
      )}
      <div className="overview-map">
        <FlowOverview
          screens={audit.screens}
          selectedScreenId={screen.id}
          onSelect={selectScreen}
          onShowAll={() => setShowFlow(true)}
        />
        <section
          id="finding-review-detail"
          aria-label="선택한 항목 검토"
          className={cn("map-workspace", detailOpen && "has-detail")}
        >
          <ScreenPreview
            key={screen.id}
            finding={detailOpen ? finding : undefined}
            screen={screen}
            findings={audit.findings.flatMap((item, index) =>
              matchesFilter(item, filter) ? [{ finding: item, number: index + 1 }] : [],
            )}
            onSelect={selectImageFinding}
            focusRequest={focusRequest}
            onReset={closeDetail}
            emptyMessage={!detailOpen && !filteredFindings.length ? emptyMessage : undefined}
          />
          {detailOpen && (
            <>
              <button
                className="map-detail-dismiss"
                tabIndex={-1}
                aria-label="상세 설명 바깥 여백"
                onClick={closeDetail}
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
                onClose={closeDetail}
              />
            </>
          )}
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
