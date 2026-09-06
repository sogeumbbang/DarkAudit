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
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { AuditDto, AuditScreenDto, FindingDto } from "@/entities/audit/types";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { ScreenCanvas } from "@/features/finding-review/ScreenCanvas";
import { useFindingStatus } from "@/features/finding-review/useFindingStatus";
import { cn } from "@/lib/cn";

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
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">가입 흐름 요약</h2>
        <button
          className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-xs font-semibold text-brand-700"
          onClick={onShowAll}
        >
          전체 흐름 보기 <ArrowRight size={13} />
        </button>
      </div>
      <div className="mt-5 grid grid-cols-5 gap-2 overflow-x-auto py-2">
        {screens.map((screen, index) => (
          <button
            className={cn(
              "relative min-w-20 rounded-control p-1 text-center",
              selectedScreenId === screen.id && "bg-brand-50 ring-2 ring-inset ring-brand-500",
            )}
            key={screen.id}
            onClick={() => onSelect(screen.id)}
          >
            {index < screens.length - 1 && (
              <span className="absolute left-[60%] top-3 h-px w-[80%] border-t border-dashed border-muted/40" />
            )}
            <div className="relative mx-auto flex size-6 items-center justify-center rounded-full bg-brand-900 text-[9px] font-bold text-white">
              {index + 1}
              {screen.findingCount > 0 && (
                <span className="absolute -right-5 flex size-4 items-center justify-center rounded-full bg-danger text-[8px]">
                  {screen.findingCount}
                </span>
              )}
            </div>
            <div className="mx-auto mt-4 flex h-24 w-16 items-center justify-center overflow-hidden rounded border border-border bg-white shadow-sm">
              <img
                alt={`${screen.flowStep} 캡처 화면`}
                className="max-h-full max-w-full object-contain"
                loading="lazy"
                src={screen.imageUrl}
              />
            </div>
            <p className="mt-2 truncate text-[10px] font-medium">{screen.flowStep}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ScreenPreview({ screen, finding }: { screen: AuditScreenDto; finding?: FindingDto }) {
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
    <div ref={previewRef}>
      <Card className="relative mt-4 min-h-[380px] overflow-hidden p-5">
        <h2 className="text-sm font-bold">화면 미리보기</h2>
        <div
          aria-label="화면 미리보기 이동 영역"
          data-testid="screen-preview-viewport"
          className={cn(
            "scrollbar-hidden absolute inset-x-0 bottom-0 top-14 touch-none select-none overflow-auto bg-gradient-to-b from-white to-brand-50/60 p-5",
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
            className="flex min-h-full min-w-full items-center justify-center transition-[width,height]"
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
      </Card>
    </div>
  );
}

function FindingDetails({
  finding,
  position,
  total,
  onStep,
}: {
  finding?: FindingDto;
  position: number;
  total: number;
  onStep: (delta: number) => void;
}) {
  const findingStatus = useFindingStatus();
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="text-sm font-bold">탐지 항목 상세</h2>
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
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-brand-700">{finding.ruleId}</p>
            <Badge variant={finding.status === "resolved" ? "success" : "danger"}>
              ●&nbsp; {finding.status === "resolved" ? "해결됨" : "검토 필요"}
            </Badge>
          </div>
          <h3 className="mt-3 text-2xl font-bold">{finding.title}</h3>
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
              <p className="text-sm font-bold">금융위원회 금융소비자 보호 가이드라인</p>
              <p className="mt-2 text-xs leading-6 text-muted">{finding.guideline}</p>
            </div>
          </div>
          <button
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-control border border-brand-700 py-3 text-sm font-semibold text-brand-700"
            onClick={() => setShowRecommendation((value) => !value)}
          >
            개선 권고안 보기
            <ArrowRight size={15} />
          </button>
          {showRecommendation && (
            <div className="mt-3 rounded-card bg-brand-50 p-4 text-sm leading-6 text-brand-950">
              {finding.recommendation}
            </div>
          )}
          {showMetadata && (
            <div className="mt-3 rounded-card border border-border p-4 text-xs text-muted">
              신뢰도 {Math.round(finding.confidence * 100)}% · 심각도 {finding.severity}
            </div>
          )}
          <button
            className={cn(
              "mt-3 flex w-full items-center justify-center gap-2 rounded-control py-3 text-sm font-semibold text-white disabled:opacity-50",
              finding.status === "resolved" ? "bg-muted" : "bg-brand-700",
            )}
            disabled={findingStatus.isPending}
            onClick={() =>
              findingStatus.mutate({
                findingId: finding.id,
                status: finding.status === "resolved" ? "reviewing" : "resolved",
              })
            }
          >
            {findingStatus.isPending ? (
              <RefreshCw className="animate-spin" size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            {finding.status === "resolved" ? "검토 상태로 되돌리기" : "해결됨으로 표시"}
          </button>
        </div>
      ) : (
        <div className="flex min-h-96 flex-col items-center justify-center p-8 text-center">
          <CheckCircle2 className="text-success" size={34} />
          <h3 className="mt-4 font-bold">탐지된 항목이 없습니다</h3>
          <p className="mt-2 text-sm text-muted">
            이 진단에서는 검토가 필요한 UX 패턴이 발견되지 않았습니다.
          </p>
        </div>
      )}
    </Card>
  );
}

function FindingsRow({
  findings,
  selectedFindingId,
  onSelect,
}: {
  findings: FindingDto[];
  selectedFindingId?: string;
  onSelect: (finding: FindingDto) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!findings.length) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.05fr]">
      {findings.slice(0, showAll ? findings.length : 3).map((finding) => (
        <button className="text-left" key={finding.id} onClick={() => onSelect(finding)}>
          <Card
            className={cn(
              "h-full p-5",
              selectedFindingId === finding.id && "border-danger/60 ring-1 ring-danger/20",
            )}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-brand-700">{finding.ruleId}</p>
              <Badge
                variant={
                  finding.status === "resolved"
                    ? "success"
                    : finding.severity === "HIGH"
                      ? "danger"
                      : "warning"
                }
              >
                {finding.status === "resolved" ? "해결됨" : "검토 필요"}
              </Badge>
            </div>
            <div className="mt-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold">{finding.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted">{finding.description}</p>
              </div>
              <ChevronRight className="mt-1 shrink-0" size={16} />
            </div>
          </Card>
        </button>
      ))}
      {findings.length > 3 && (
        <button className="text-left" onClick={() => setShowAll((value) => !value)}>
          <Card className="flex h-full items-center justify-between p-5">
            <div>
              <p className="font-bold">{showAll ? "탐지 항목 접기" : "탐지 항목 전체 보기"}</p>
              <p className="mt-2 text-xs text-muted">총 {findings.length}개</p>
            </div>
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-700 text-white">
              <ArrowRight size={15} />
            </span>
          </Card>
        </button>
      )}
    </div>
  );
}

function RecentAudits({
  audits,
  onSelect,
}: {
  audits: AuditDto[];
  onSelect: (auditId: string) => void;
}) {
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="text-sm font-bold">최근 진단</h2>
        <Link
          className="flex items-center gap-2 text-xs font-semibold text-brand-700"
          to="/app/audits"
        >
          전체 진단 보기 <ArrowRight size={13} />
        </Link>
      </div>
      <div aria-label="최근 진단 표" className="overflow-x-auto" tabIndex={0}>
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead className="border-b border-border bg-black/[0.015] text-muted">
            <tr>
              {["진단 이름", "플랫폼", "화면", "탐지 항목", "상태", "최근 수정", ""].map((head) => (
                <th className="px-6 py-3 font-medium" key={head}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {audits.map((audit) => (
              <tr
                className="cursor-pointer hover:bg-brand-50/50"
                key={audit.id}
                onClick={() => onSelect(audit.id)}
              >
                <td className="px-6 py-4 font-semibold">{audit.name}</td>
                <td className="px-6 py-4">
                  <span className="flex items-center gap-2">
                    <Smartphone size={14} /> 모바일 웹
                  </span>
                </td>
                <td className="px-6 py-4">{audit.screens.length}</td>
                <td className="px-6 py-4">
                  <span className="flex gap-5">
                    <i className="not-italic text-danger">● {audit.findings.length}</i>
                    <i className="not-italic text-warning">
                      ● {audit.findings.filter((finding) => finding.status !== "resolved").length}
                    </i>
                    <i className="not-italic text-success">
                      ● {audit.findings.filter((finding) => finding.status === "resolved").length}
                    </i>
                  </span>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={auditStatusPresentation[audit.status].variant}>
                    {auditStatusPresentation[audit.status].label}
                  </Badge>
                </td>
                <td className="px-6 py-4">
                  {new Intl.DateTimeFormat("ko-KR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(audit.updatedAt))}
                </td>
                <td className="px-6 py-4">
                  <MoreVertical size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DashboardLoading() {
  return (
    <div
      aria-label="대시보드 불러오는 중"
      className="mx-auto max-w-[1500px] animate-pulse"
      role="status"
    >
      <div className="h-8 w-32 rounded bg-black/10" />
      <div className="mt-6 h-44 rounded-card bg-brand-900/20" />
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
  const [showFlow, setShowFlow] = useState(false);

  if (isPending) {
    return <DashboardLoading />;
  }

  if (isError) {
    return (
      <Card className="mx-auto mt-20 max-w-lg p-10 text-center">
        <CircleAlert className="mx-auto text-danger" size={36} />
        <h1 className="mt-5 text-xl font-bold">대시보드를 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm text-muted">
          {error instanceof Error ? error.message : "잠시 후 다시 시도해주세요."}
        </p>
        <button
          className="mx-auto mt-6 flex items-center gap-2 rounded-control bg-brand-700 px-5 py-3 text-sm font-semibold text-white"
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
          className="mx-auto mt-6 inline-flex rounded-control bg-brand-700 px-5 py-3 text-sm font-semibold text-white"
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
          className="mx-auto mt-6 inline-flex rounded-control bg-brand-700 px-5 py-3 text-sm font-semibold text-white"
          to="/app/audits/new"
        >
          새 진단 시작하기
        </Link>
      </Card>
    );
  }
  const finding =
    audit.findings.find((item) => item.id === searchParams.get("finding")) ?? audit.findings[0];
  // 화면을 명시하지 않았다면 선택된 항목이 있는 화면을 띄운다. 둘을 각각 고르면
  // 첫 진입에서 "1번 화면 + 2번 화면의 탐지 항목"처럼 어긋나 위치 강조가 안 보인다.
  const screen =
    audit.screens.find((item) => item.id === searchParams.get("screen")) ??
    audit.screens.find((item) => item.id === finding?.bbox?.screenId) ??
    audit.screens.find((item) => item.id === finding?.screenIds[0]) ??
    audit.screens[0]!;
  const findingPosition = finding ? audit.findings.findIndex((item) => item.id === finding.id) : 0;
  const needsReview = audit.findings.filter((item) => item.status !== "resolved").length;
  const resolved = audit.findings.filter((item) => item.status === "resolved").length;
  const auditStatus = auditStatusPresentation[audit.status];
  const metrics = [
    {
      label: "탐지된 항목",
      value: audit.findings.length,
      icon: ShieldCheck,
      action: "전체 보기",
      color: "text-brand-400",
    },
    {
      label: "검토 필요",
      value: needsReview,
      icon: CircleAlert,
      action: "지금 검토",
      color: "text-warning",
    },
    {
      label: "해결됨",
      value: resolved,
      icon: CheckCircle2,
      action: "해결 항목 보기",
      color: "text-white",
    },
  ];

  function selectAudit(auditId: string) {
    setSearchParams({ audit: auditId });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectScreen(screenId: string) {
    const relatedFinding = audit.findings.find((item) => item.screenIds.includes(screenId));
    setSearchParams((current) => {
      current.set("audit", audit.id);
      current.set("screen", screenId);
      if (relatedFinding) current.set("finding", relatedFinding.id);
      else current.delete("finding");
      return current;
    });
  }

  function selectFinding(nextFinding: FindingDto) {
    setSearchParams({
      audit: audit.id,
      // 위치 강조가 보이도록 bbox 가 있는 화면을 우선한다. DA-15 처럼 여러 화면에
      // 걸친 항목은 screenIds[0](최초 화면)과 bbox 화면(마지막 근거)이 다르다.
      screen: nextFinding.bbox?.screenId ?? nextFinding.screenIds[0] ?? screen.id,
      finding: nextFinding.id,
    });
  }

  function selectMetric(label: string) {
    const next =
      label === "해결됨"
        ? audit.findings.find((item) => item.status === "resolved")
        : label === "검토 필요"
          ? audit.findings.find((item) => item.status !== "resolved")
          : audit.findings[0];
    if (next) selectFinding(next);
  }

  // 카드로는 3건까지만 노출되므로, 그 뒤 항목은 이 화살표로만 닿을 수 있다.
  function stepFinding(delta: number) {
    if (audit.findings.length < 2) return;
    const total = audit.findings.length;
    const next = audit.findings[(findingPosition + delta + total) % total]!;
    selectFinding(next);
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
      {audit.analysisSummary?.supportedRules && (
        <section
          aria-label="분석 범위"
          className="mt-4 rounded-card border border-line bg-white p-4"
        >
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
                className="rounded border border-line px-2 py-1 text-xs"
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
      <section className="subtle-grid mt-6 overflow-hidden rounded-card bg-brand-900 p-6 text-white lg:p-8">
        <div className="grid items-center gap-8 xl:grid-cols-[1fr_1.15fr]">
          <div>
            {/*
              variant 색은 밝은 표면 기준이라 어두운 히어로 위에서는 대비가 깨진다.
              text-white 로 덮으면 bg-brand-100 위 흰 글씨가 되어 대비 1.17 까지
              떨어졌다. 여기서는 히어로에 맞는 색을 직접 준다. 상태는 색이 아니라
              라벨 문구가 전달하므로 정보가 사라지지도 않는다.
            */}
            <Badge className="bg-white/15 text-white">●&nbsp; {auditStatus.label}</Badge>
            <h2 className="mt-4 text-2xl font-bold sm:text-3xl">{audit.name}</h2>
            <div className="mt-5 flex flex-wrap gap-6 text-xs text-white/70">
              <span className="flex items-center gap-2">
                <Smartphone size={15} /> 모바일 웹
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
          </div>
          <div className="grid grid-cols-1 divide-y divide-white/15 rounded-card border border-white/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {metrics.map(({ label, value, icon: Icon, action, color }) => (
              <button
                className="p-5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                disabled={value === 0}
                key={label}
                onClick={() => selectMetric(label)}
              >
                <div className="flex items-center gap-3">
                  <Icon className={color} size={22} />
                  <span className="text-2xl font-bold">{value}</span>
                </div>
                <p className="mt-3 text-xs font-semibold">{label}</p>
                <p className="mt-5 flex items-center gap-2 text-xs text-brand-400">
                  {action} <ArrowRight size={12} />
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div>
          <FlowOverview
            screens={audit.screens}
            selectedScreenId={screen.id}
            onSelect={selectScreen}
            onShowAll={() => setShowFlow(true)}
          />
          <ScreenPreview finding={finding} screen={screen} />
        </div>
        <FindingDetails
          finding={finding}
          key={finding?.id ?? "no-finding"}
          onStep={stepFinding}
          position={findingPosition}
          total={audit.findings.length}
        />
      </div>
      <div className="mt-4">
        <FindingsRow
          findings={audit.findings}
          selectedFindingId={finding?.id}
          onSelect={selectFinding}
        />
      </div>
      <RecentAudits audits={data.audits} onSelect={selectAudit} />
      {showFlow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="전체 가입 흐름"
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
                  <p className="mt-3 text-sm font-bold">
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
