import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ChevronDown,
  FileText,
  GitCompareArrows,
  Layers2,
  ListChecks,
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
import { AuditFlowHeader } from "@/features/recheck/AuditFlowHeader";
import { RecheckSteps } from "@/features/recheck/RecheckSteps";
import { AnalysisNotice } from "@/features/audit-report/AnalysisNotice";
import type { AuditDto, AuditScreenDto, FindingDto } from "@/entities/audit/types";
import { orderFindings } from "@/entities/audit/orderFindings";
import { isFindingOnScreen } from "@/entities/audit/findingScreens";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { ScreenPreview } from "./ScreenPreview";
import { guidelineCategories } from "@/pages/support/guidelines";
import { FindingDecisionNote } from "@/features/finding-review/FindingDecisionNote";
import { useFindingStatus } from "@/features/finding-review/useFindingStatus";
import { cn } from "@/lib/cn";
import {
  BeforeAfterPreview,
  ChangePanel,
  RevisionMetrics,
  RunBadge,
  RunSwitch,
  ScreenChangeTag,
} from "@/features/recheck/RevisionOverview";
import { baseRun, largestChange, latestRun, type ScreenChange } from "@/features/recheck/runs";
import { useAuditRun, useRegression } from "@/features/recheck/useRecheckData";

import "./overview.css";
import "@/features/recheck/recheck.css";

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

function FindingStatusBadge({ finding }: { finding: FindingDto }) {
  return (
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
  );
}

function ReviewSummary({ audit }: { audit: AuditDto }) {
  const total = audit.findings.length;
  const open = audit.findings.filter((item) => item.status === "open").length;
  const reviewing = audit.findings.filter((item) => item.status === "reviewing").length;
  const resolved = audit.findings.filter((item) => item.status === "resolved").length;
  return (
    <section className="overview-metrics" aria-label="진단 현황">
      <div className="overview-metric overview-metric--total">
        <div className="overview-metric-label">
          <span>전체 검토 후보</span>
          <ListChecks size={18} aria-hidden="true" />
        </div>
        <p className="overview-metric-value">
          {total}
          <span>건</span>
        </p>
        <p className="overview-metric-note">화면의 근거를 바탕으로 확인하세요</p>
      </div>
      <div className="overview-metric">
        <div className="overview-metric-label">
          <span>검토 필요</span>
          <CircleAlert size={18} aria-hidden="true" />
        </div>
        <p className="overview-metric-value">
          {open + reviewing}
          <span>건</span>
        </p>
        <p className="overview-metric-note">
          <i className="metric-dot metric-dot--warm" aria-hidden="true" />
          미검토 {open} · 검토 중 {reviewing}
        </p>
      </div>
      <div className="overview-metric overview-metric--resolved">
        <div className="overview-metric-label">
          <span>해결 표시</span>
          <CheckCircle2 size={18} aria-hidden="true" />
        </div>
        <p className="overview-metric-value">
          {resolved}
          <span>/ {total}건</span>
        </p>
        <div className="overview-status-track" aria-hidden="true">
          <span style={{ width: `${total ? (resolved / total) * 100 : 0}%` }} />
        </div>
        <p className="overview-metric-note">검토자가 지정한 상태 기준</p>
      </div>
      <div className="overview-metric">
        <div className="overview-metric-label">
          <span>등록 화면</span>
          <Layers2 size={18} aria-hidden="true" />
        </div>
        <p className="overview-metric-value">
          {audit.screens.length}
          <span>개</span>
        </p>
        <p className="overview-metric-note">
          {
            { "mobile-web": "모바일 웹", "desktop-web": "데스크톱 웹", app: "모바일 앱" }[
              audit.platform
            ]
          }{" "}
          · 화면별 근거 확인
        </p>
      </div>
    </section>
  );
}

function FlowOverview({
  screens,
  selectedScreenId,
  onSelect,
  onShowAll,
  changes,
}: {
  screens: AuditScreenDto[];
  selectedScreenId: string;
  onSelect: (screenId: string) => void;
  onShowAll: () => void;
  changes?: Map<string, ScreenChange>;
}) {
  return (
    <aside className="map-screens" aria-label="가입 흐름 요약">
      <div className="map-flow-heading">
        <div>
          <span className="overview-kicker">SCREEN FLOW</span>
          <h2>
            화면 흐름 <span>{screens.length}</span>
          </h2>
        </div>
        <button
          aria-label="전체 흐름 보기"
          title="전체 흐름 보기"
          onClick={onShowAll}
          className="rounded p-1 text-muted hover:bg-brand-50"
        >
          전체 보기 <ArrowRight size={14} />
        </button>
      </div>
      <div className="map-screen-list" role="group" aria-label="가입 흐름 단계">
        {screens.map((screen, index) => (
          <button
            key={screen.id}
            className={cn("map-screen", selectedScreenId === screen.id && "is-selected")}
            aria-label={`${index + 1}단계 ${screen.flowStep}, 문제 ${screen.findingCount}건`}
            title="이 화면과 관련된 문제 수 (여러 영역에 표시된 같은 문제는 1건)"
            aria-pressed={selectedScreenId === screen.id}
            onClick={() => onSelect(screen.id)}
          >
            <span className="map-screen-number">{String(index + 1).padStart(2, "0")}</span>
            <img
              alt={`${screen.flowStep} 캡처 화면`}
              src={screen.imageUrl}
              loading="lazy"
              className="mx-auto h-24 max-w-full rounded-sm bg-white object-contain shadow-sm"
            />
            <div className="map-screen-copy">
              <p>{screen.flowStep}</p>
              {changes?.get(screen.id) ? (
                <ScreenChangeTag change={changes.get(screen.id)!} />
              ) : (
                <span>
                  {screen.findingCount ? `검토 후보 ${screen.findingCount}건` : "탐지 항목 없음"}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

function FindingDetails({
  finding,
  onResolved,
  hasNextReview,
}: {
  finding: FindingDto;
  onResolved: () => void;
  hasNextReview: boolean;
}) {
  const findingStatus = useFindingStatus();
  const [showMetadata, setShowMetadata] = useState(false);
  const category = guidelineCategories.find((category) =>
    category.types.some((rule) => rule.id === finding.ruleId),
  );
  return (
    <div
      id="finding-detail-panel"
      role="region"
      aria-label={`${finding.title} 설명`}
      className="finding-inline-detail"
    >
      <h4 id="finding-detail-heading" tabIndex={-1} className="sr-only">
        탐지 항목 상세
      </h4>
      <div className="finding-editorial-body">
        <div className="finding-signals">
          <span className={finding.severity === "HIGH" ? "text-accent-ink" : ""}>
            위험도 {{ HIGH: "높음", REVIEW: "검토 필요", LOW: "낮음" }[finding.severity]}
          </span>
          <span>신뢰도 {Math.round(finding.confidence * 100)}%</span>
          {category && <span>{category.title}</span>}
        </div>
        <div className="finding-context">
          <p className="editorial-label">WHERE · 대상 요소</p>
          <p>{finding.element}</p>
          <a href="#finding-screen-preview">
            화면에서 위치 확인 <ArrowRight size={13} aria-hidden="true" />
          </a>
        </div>
        <div className="finding-observation">
          <h4 className="editorial-label">OBSERVATION · 관찰 내용</h4>
          <p>
            {finding.observation ||
              "별도의 관찰 기록이 없습니다. 화면과 판단 근거를 함께 확인하세요."}
          </p>
          {(finding.defaultState || finding.costImpact) && (
            <dl className="finding-context-facts">
              {finding.defaultState && (
                <div>
                  <dt>초기 상태</dt>
                  <dd>{finding.defaultState}</dd>
                </div>
              )}
              {finding.costImpact && (
                <div>
                  <dt>비용 영향</dt>
                  <dd>{finding.costImpact}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
        <div className="finding-rule">
          <h4 className="editorial-label">RULE · 검토 기준</h4>
          <Link to="/app/guidelines">
            {finding.ruleId} <ArrowRight size={13} aria-hidden="true" />
          </Link>
          <p>{finding.guideline}</p>
        </div>
        <div className="finding-reason">
          <h4 className="editorial-label">WHY · 검토가 필요한 이유</h4>
          <p>{finding.description}</p>
        </div>
        <div className="finding-fix">
          <p className="editorial-label">FIX · 개선 방향</p>
          <h4>개선 권고안</h4>
          <p>{finding.recommendation}</p>
        </div>
        <details className="finding-reference">
          <summary className="cursor-pointer text-xs text-muted">판단 근거 및 가이드라인</summary>
          <p className="mt-3 text-xs text-muted">
            금융위원회 금융소비자 보호 가이드라인 · {finding.ruleId}
          </p>
          <Link
            to="/app/guidelines"
            className="mt-2 inline-block text-sm underline underline-offset-4"
          >
            검토 기준 전체 보기
          </Link>
        </details>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-muted">
            수정 결정 기록
          </summary>
          <FindingDecisionNote finding={finding} />
        </details>
        <button
          aria-label="탐지 메타데이터"
          aria-expanded={showMetadata}
          className="mt-3 flex items-center gap-1 text-xs text-muted"
          onClick={() => setShowMetadata((value) => !value)}
        >
          <MoreVertical size={14} />
          분석 정보
        </button>
        {showMetadata && (
          <div className="mt-3 border-t border-border py-3 text-xs text-muted">
            <p>분석 유형 · {finding.riskType}</p>
            <p className="mt-2">연결된 화면 · {finding.screenIds.length}개</p>
          </div>
        )}
        {finding.status === "open" && (
          <Button
            className="mt-3 w-full"
            variant="outline"
            disabled={findingStatus.isPending}
            onClick={() => findingStatus.mutate({ findingId: finding.id, status: "reviewing" })}
          >
            검토 시작
          </Button>
        )}
        <button
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-2 rounded-control py-2 text-sm font-semibold text-white disabled:opacity-50",
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
    </div>
  );
}

function FindingsList({
  findings,
  allFindings,
  selectedFindingId,
  onSelect,
  onStep,
  onResolved,
  hasNextReview,
  emptyMessage,
}: {
  findings: FindingDto[];
  allFindings: FindingDto[];
  selectedFindingId?: string;
  onSelect: (finding: FindingDto) => void;
  onStep: (delta: number) => void;
  onResolved: () => void;
  hasNextReview: boolean;
  emptyMessage: string;
}) {
  const position = findings.findIndex((item) => item.id === selectedFindingId);
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedFindingId) return;
    const list = listRef.current;
    const trigger = document.getElementById(`finding-trigger-${selectedFindingId}`);
    if (!list || !trigger || list.scrollHeight <= list.clientHeight) return;
    const bounds = list.getBoundingClientRect();
    const item = trigger.getBoundingClientRect();
    if (item.top < bounds.top || bounds.bottom - item.top < Math.min(360, list.clientHeight)) {
      list.scrollTop += item.top - bounds.top;
    }
  }, [selectedFindingId]);
  return (
    <section className="review-findings" aria-label="문제 목록">
      <div className="review-findings-heading">
        <div>
          <p className="overview-kicker">FINDINGS</p>
          <h2 className="text-sm font-semibold">
            전체 진단 문제{" "}
            <span className="ml-1 text-muted">
              {findings.length === allFindings.length
                ? `${allFindings.length}건`
                : `${findings.length} / ${allFindings.length}건`}
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums text-muted">
          <button
            aria-label="이전 탐지 항목"
            disabled={findings.length < 2}
            onClick={() => onStep(-1)}
            className="rounded p-1 disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {position + 1} / {findings.length}
          </span>
          <button
            aria-label="다음 탐지 항목"
            disabled={findings.length < 2}
            onClick={() => onStep(1)}
            className="rounded p-1 disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <nav ref={listRef} aria-label="점검 항목" className="review-findings-list">
        {findings.map((finding) => {
          const selected = selectedFindingId === finding.id;
          const number = allFindings.findIndex((item) => item.id === finding.id) + 1;
          return (
            <article key={finding.id} className={cn("review-finding", selected && "is-selected")}>
              <button
                id={`finding-trigger-${finding.id}`}
                className="w-full px-3 py-2.5 text-left hover:bg-brand-50/60"
                aria-expanded={selected}
                aria-current={selected ? "true" : undefined}
                aria-controls={selected ? "finding-detail-panel" : undefined}
                onClick={() => onSelect(finding)}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-label={`항목 ${number}번`}
                    className="flex size-7 shrink-0 items-center justify-center rounded bg-brand-600 text-xs font-bold text-white"
                  >
                    {number}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="min-w-0 flex-1">
                      {selected && <p className="finding-what-label">WHAT · 발견한 문제</p>}
                      <h3 className="min-w-0 flex-1 text-sm font-semibold leading-7">
                        {finding.title}
                      </h3>
                    </div>
                    <span className="shrink-0">
                      <FindingStatusBadge finding={finding} />
                    </span>
                  </div>
                  <ChevronDown
                    size={16}
                    className={cn("mt-1 shrink-0 text-muted", selected && "rotate-180")}
                  />
                </div>
              </button>
              {!selected && (
                <div className="finding-list-context">
                  <p>{finding.element}</p>
                  <span>{finding.ruleId}</span>
                  <span>연결 화면 {finding.screenIds.length}개</span>
                </div>
              )}
              {selected && (
                <FindingDetails
                  finding={finding}
                  onResolved={onResolved}
                  hasNextReview={hasNextReview}
                />
              )}
            </article>
          );
        })}
        {!findings.length && (
          <div className="p-6 text-center" role="status">
            <h3 className="text-sm font-semibold">{emptyMessage}</h3>
            <p className="mt-2 text-xs text-muted">다른 필터나 화면을 선택해 확인할 수 있습니다.</p>
          </div>
        )}
      </nav>
    </section>
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
  const selectionSnapshot = searchParams.toString();
  const latestSelection = useRef(selectionSnapshot);
  useEffect(() => {
    latestSelection.current = selectionSnapshot;
  }, [selectionSnapshot]);
  const [showFlow, setShowFlow] = useState(false);
  const flowBackdropPointerDown = useRef(false);
  const [showReport, setShowReport] = useState(false);
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  const detailOpen = Boolean(searchParams.get("finding") || searchParams.get("panel"));
  const summaryAudit =
    data?.audits.find((item) => item.id === searchParams.get("audit")) ??
    data?.audits.find((item) => item.id === data.activeAuditId) ??
    data?.audits[0];
  // ?version=N reopens a completed run; the summary itself only holds the latest one.
  const latest = summaryAudit && latestRun(summaryAudit);
  const base = summaryAudit && baseRun(summaryAudit);
  const requestedVersion = Number(searchParams.get("version")) || undefined;
  const viewRun =
    (summaryAudit?.runs ?? []).find(
      (run) => run.version === requestedVersion && run.status === "completed",
    ) ?? latest;
  const historical = Boolean(viewRun && latest && viewRun.version !== latest.version);
  const runResult = useAuditRun(summaryAudit?.id, historical ? viewRun?.version : undefined);
  const revision = Boolean(viewRun && base && viewRun.version > base.version);
  const regression = useRegression(
    summaryAudit?.id,
    revision ? base?.version : undefined,
    revision ? viewRun?.version : undefined,
    summaryAudit?.updatedAt,
  );
  const originalResult = useAuditRun(summaryAudit?.id, revision ? base?.version : undefined);

  if (isPending || (historical && runResult.isPending)) {
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

  const audit: AuditDto =
    historical && runResult.data ? { ...runResult.data, runs: summaryAudit!.runs } : summaryAudit!;
  const changes = revision ? regression.data?.screenChanges : undefined;
  const hasRevision = Boolean(base && latest && latest.version > base.version);
  const completedCount = (audit.runs ?? []).filter((run) => run.status === "completed").length;
  const changeByScreen = changes && new Map(changes.map((item) => [item.screenId, item]));
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
  const orderedFindings = orderFindings(audit);
  const orderedScreens = [...audit.screens]
    .sort((a, b) => a.order - b.order)
    .map((screen) => ({
      ...screen,
      findingCount: orderedFindings.filter((item) => isFindingOnScreen(item, screen.id)).length,
    }));
  const filterParam = searchParams.get("filter");
  const filter: FindingFilter =
    filterParam === "needs-review" || filterParam === "resolved" ? filterParam : "all";
  const filteredFindings = orderedFindings.filter((item) => matchesFilter(item, filter));
  const requestedScreen = searchParams.get("screen");
  const requestedFinding = searchParams.get("finding");
  const selectedFinding = filteredFindings.find((item) => item.id === requestedFinding);
  const finding =
    selectedFinding ??
    (requestedScreen && !requestedFinding
      ? filteredFindings.find((item) => isFindingOnScreen(item, requestedScreen))
      : filteredFindings[0]);
  // 화면을 명시하지 않았다면 선택된 항목이 있는 화면을 띄운다. 둘을 각각 고르면
  // 첫 진입에서 "1번 화면 + 2번 화면의 탐지 항목"처럼 어긋나 위치 강조가 안 보인다.
  const biggest = changes && largestChange(changes);
  const screen =
    (selectedFinding || !requestedFinding
      ? orderedScreens.find((item) => item.id === requestedScreen)
      : undefined) ??
    (!requestedFinding && biggest
      ? orderedScreens.find((item) => item.id === biggest.screenId)
      : undefined) ??
    orderedScreens.find((item) => item.id === finding?.bbox?.screenId) ??
    orderedScreens.find((item) => item.id === finding?.screenIds[0]) ??
    orderedScreens[0]!;
  const findingPosition =
    detailOpen && finding ? filteredFindings.findIndex((item) => item.id === finding.id) : -1;
  const originalPosition = orderedFindings.findIndex((item) => item.id === finding?.id);
  const reviewOrder = !detailOpen
    ? orderedFindings
    : [
        ...orderedFindings.slice(originalPosition + 1),
        ...orderedFindings.slice(0, originalPosition + 1),
      ];
  const nextReview = reviewOrder.find(
    (item) => (!detailOpen || item.id !== finding?.id) && item.status !== "resolved",
  );
  const emptyMessage = !orderedFindings.length
    ? "탐지된 항목이 없습니다"
    : !filteredFindings.length
      ? filter === "resolved"
        ? "해결된 항목이 없습니다"
        : "검토가 필요한 항목이 없습니다"
      : "이 화면에 해당하는 점검 항목이 없습니다";
  const needsReview = orderedFindings.filter((item) => item.status !== "resolved").length;
  const resolved = orderedFindings.filter((item) => item.status === "resolved").length;
  function closeDetail() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("screen", screen.id);
      next.delete("finding");
      next.delete("panel");
      return next;
    });
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
    setSearchParams((current) => findingParams(current, nextFinding, filter));
  }

  function selectListFinding(nextFinding: FindingDto) {
    if (detailOpen && finding?.id === nextFinding.id) {
      closeDetail();
      return;
    }
    selectFinding(nextFinding);
  }

  function selectImageFinding(nextFinding: FindingDto) {
    setSearchParams((current) => {
      const params = findingParams(current, nextFinding, filter);
      params.set("screen", screen.id);
      return params;
    });
  }

  function selectFilter(nextFilter: FindingFilter) {
    const next =
      finding && matchesFilter(finding, nextFilter)
        ? finding
        : orderedFindings.find((item) => matchesFilter(item, nextFilter));
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
    <div className="overview-page workspace-page mx-auto max-w-[1800px]">
      <AuditFlowHeader
        audit={audit}
        kicker="AUDIT OVERVIEW"
        pageTitle="진단 결과 상세"
        subtitle="화면의 문제를 살펴보고, 개선의 다음 단계를 정하세요."
        badge={viewRun && completedCount > 1 ? <RunBadge audit={audit} run={viewRun} /> : undefined}
        actions={
          <>
            {audit.status !== "queued" && audit.status !== "analyzing" && (
              <Button asChild variant={audit.demoPreset && !hasRevision ? "primary" : "outline"}>
                <Link to={`/app/audits/${encodeURIComponent(audit.id)}/recheck`}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {hasRevision ? "새 수정본 검사" : "수정본 검사하기"}
                </Link>
              </Button>
            )}
            {hasRevision && (
              <Button asChild className="overview-demo-next">
                <Link to={`/app/benchmark?audit=${encodeURIComponent(audit.id)}`}>
                  <GitCompareArrows size={15} aria-hidden="true" />
                  전후 비교
                </Link>
              </Button>
            )}
            <Button variant="outline" ref={reportButtonRef} onClick={() => setShowReport(true)}>
              <FileText size={16} aria-hidden="true" /> PDF 보고서 출력
            </Button>
          </>
        }
      >
        {/* The steps already link the original and latest revision; list runs only when more exist. */}
        {viewRun && completedCount > 2 && (
          <div className="rc">
            <RunSwitch audit={audit} current={viewRun.version} />
          </div>
        )}
      </AuditFlowHeader>
      {(audit.demoPreset || hasRevision) && (
        <div className="rc">
          <RecheckSteps audit={audit} current={revision ? 2 : 1} />
        </div>
      )}
      {showReport && (
        <AuditReport
          audit={audit}
          onClose={() => {
            setShowReport(false);
            requestAnimationFrame(() => reportButtonRef.current?.focus());
          }}
        />
      )}
      {revision && regression.data && base && viewRun ? (
        <RevisionMetrics audit={audit} base={base} run={viewRun} regression={regression.data} />
      ) : (
        <ReviewSummary audit={audit} />
      )}
      <AnalysisNotice summary={audit.analysisSummary} findingCount={audit.findings.length} />
      <section aria-label="진단 요약" className="map-toolbar">
        <div role="group" aria-label="점검 항목 필터" className="overview-filters">
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
              <span>
                {value === "all"
                  ? orderedFindings.length
                  : value === "needs-review"
                    ? needsReview
                    : resolved}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
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
      <div className="overview-review">
        <FlowOverview
          screens={orderedScreens}
          selectedScreenId={screen.id}
          onSelect={selectScreen}
          onShowAll={() => setShowFlow(true)}
          changes={changeByScreen}
        />
        <section
          id="finding-review-detail"
          aria-label="선택한 항목 검토"
          className="review-workspace"
        >
          {revision && !detailOpen && regression.data && base && viewRun ? (
            <>
              <BeforeAfterPreview
                screen={screen}
                original={originalResult.data?.screens.find((item) => item.id === screen.id)}
                change={changeByScreen?.get(screen.id)}
                base={base}
                run={viewRun}
              />
              <ChangePanel
                audit={audit}
                regression={regression.data}
                onReview={(findingId) => {
                  const target = orderedFindings.find((item) => item.id === findingId);
                  if (target) selectListFinding(target);
                }}
              />
            </>
          ) : (
            <>
              <ScreenPreview
                key={screen.id}
                finding={detailOpen ? finding : undefined}
                screen={screen}
                visibleFindingCount={
                  filteredFindings.filter((item) => isFindingOnScreen(item, screen.id)).length
                }
                findings={orderedFindings.flatMap((item, index) =>
                  matchesFilter(item, filter) ? [{ finding: item, number: index + 1 }] : [],
                )}
                onSelect={selectImageFinding}
              />
              <FindingsList
                findings={filteredFindings}
                allFindings={orderedFindings}
                selectedFindingId={detailOpen ? finding?.id : undefined}
                onSelect={selectListFinding}
                onStep={stepFinding}
                onResolved={afterResolved}
                hasNextReview={Boolean(nextReview)}
                emptyMessage={emptyMessage}
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
              {orderedScreens.map((item) => (
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
