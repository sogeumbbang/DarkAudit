import { FileText, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import type { RegressionDto } from "@/api/schemas";
import { PageHeading } from "@/components/common/PageHeading";
import { Button } from "@/components/ui/Button";
import type { AuditDto } from "@/entities/audit/types";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { AuditFlowHeader } from "@/features/recheck/AuditFlowHeader";
import { RecheckSteps } from "@/features/recheck/RecheckSteps";
import { completedRuns, ruleTitle, runLabel } from "@/features/recheck/runs";
import { useRegression } from "@/features/recheck/useRecheckData";
import { cn } from "@/lib/cn";
import "@/features/recheck/recheck.css";

type Change = RegressionDto["resolved"][number];

const severityLabels = { HIGH: "위험 높음", REVIEW: "검토 필요", LOW: "낮음" };
const remainingKinds = [
  ["new", "신규", "이번 회차에 새로 탐지되었습니다."],
  ["regressed", "재발", "과거에 해결된 항목이 다시 탐지되었습니다."],
  ["persisted", "유지", "원본 항목이 이번에도 탐지되었습니다."],
  ["improved", "개선", "원본 항목이 남아 있으나 위험도가 낮아졌습니다."],
  ["pending", "보류", "원본 항목이 보이지 않지만 해결을 확인할 근거가 부족합니다."],
] as const;

function where(change: Change) {
  return [change.location, change.element].filter(Boolean).join(" · ") || "위치 정보 없음";
}

function Summary({
  result,
  before,
  after,
}: {
  result: RegressionDto;
  before: number;
  after: number;
}) {
  const ratio =
    result.comparisonStatus === "empty"
      ? "비교할 항목 없음"
      : result.comparisonStatus === "incomplete" || result.resolvedRatio === null
        ? "산출 보류"
        : `${Math.round(result.resolvedRatio * 100)}%`;
  return (
    <section className="rc-band" aria-label="비교 요약">
      <div>
        <p>탐지 항목</p>
        <p className="rc-band-value">
          {before} → {after}건
        </p>
      </div>
      <div>
        <p>원본 항목 해결률</p>
        <p className="rc-band-value">{ratio}</p>
      </div>
      <div className="rc-band-cells">
        {(
          [
            ["해결", result.resolved.length],
            ["유지", result.persisted.length + result.improved.length],
            ["신규", result.new.length],
            ["재발", result.regressed.length],
          ] as const
        ).map(([label, count]) => (
          <div key={label}>
            <b>{count}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Both ends of the comparison live in the URL, shared by the header controls and the body. */
function useComparisonRange(audit: AuditDto) {
  const [params, setParams] = useSearchParams();
  const runs = completedRuns(audit);
  const from = runs.find((run) => run.version === Number(params.get("from"))) ?? runs[0];
  const to = runs.find((run) => run.version === Number(params.get("to"))) ?? runs.at(-1);
  function choose(key: "from" | "to", version: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, version);
      return next;
    });
  }
  return { runs, from, to, choose };
}

function CompareControls({ audit }: { audit: AuditDto }) {
  const { runs, from, to, choose } = useComparisonRange(audit);
  if (runs.length < 2 || !from || !to) return null;
  return (
    <>
      <label className="rc-no-print min-w-36 flex-1 text-xs font-semibold sm:flex-none">
        <span className="sr-only">비교 기준</span>
        <select
          aria-label="비교 기준"
          className="rc-select"
          value={from.version}
          onChange={(event) => choose("from", event.target.value)}
        >
          {runs.slice(0, -1).map((run) => (
            <option key={run.id} value={run.version} disabled={run.version >= to.version}>
              기준 · {runLabel(audit, run)} {run.findingCount}건
            </option>
          ))}
        </select>
      </label>
      <label className="rc-no-print min-w-36 flex-1 text-xs font-semibold sm:flex-none">
        <span className="sr-only">비교 대상</span>
        <select
          aria-label="비교 대상"
          className="rc-select"
          value={to.version}
          onChange={(event) => choose("to", event.target.value)}
        >
          {runs.slice(1).map((run) => (
            <option key={run.id} value={run.version} disabled={run.version <= from.version}>
              대상 · {runLabel(audit, run)} {run.findingCount}건
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function Comparison({ audit }: { audit: AuditDto }) {
  const { runs, from, to } = useComparisonRange(audit);
  const comparison = useRegression(audit.id, from?.version, to?.version, audit.updatedAt);
  const result = comparison.data;
  const id = encodeURIComponent(audit.id);

  return (
    <div className="space-y-5">
      {(audit.status === "queued" || audit.status === "analyzing" || audit.status === "failed") && (
        <p className="rc-muted text-sm">
          최신 작업은 {audit.status === "failed" ? "실패했습니다" : "진행 중입니다"}. 비교에는
          완료된 회차만 사용합니다.
        </p>
      )}
      {runs.length < 2 || !from || !to ? (
        <section className="rc-card">
          <h2 className="font-bold">비교할 완료 회차가 부족합니다</h2>
          <p className="rc-muted mt-2 text-sm">
            같은 진단에 수정본을 등록해 두 회차 이상 분석을 완료해 주세요.
          </p>
          <Link className="rc-gold-btn mt-4" to={`/app/audits/${id}/recheck`}>
            수정본 검사로 이동
          </Link>
        </section>
      ) : (
        <>
          {comparison.isPending ? (
            <p role="status">비교 결과를 불러오는 중입니다.</p>
          ) : comparison.isError ? (
            <section className="rc-card">
              <p role="alert">비교 결과를 불러오지 못했습니다. {comparison.error.message}</p>
              <Button className="mt-3" onClick={() => void comparison.refetch()}>
                다시 불러오기
              </Button>
            </section>
          ) : result ? (
            <>
              <h2 className="text-lg font-bold">
                {runLabel(audit, from)} → {runLabel(audit, to)} 비교
              </h2>
              <Summary result={result} before={from.findingCount} after={to.findingCount} />
              <p className="rc-muted text-xs leading-5">
                해결률은 원본 항목 중 같은 기준으로 다시 검사했을 때 잡히지 않은 비율입니다.
                신규·재발은 분모에 넣지 않습니다.
              </p>
              {result.scopeDescription && (
                <p className="rc-muted text-sm leading-6">{result.scopeDescription}</p>
              )}
              {result.comparisonStatus === "empty" && (
                <section className="rc-card" role="status">
                  <h3 className="font-bold">비교할 항목 없음</h3>
                  <p className="rc-muted mt-2 text-sm">
                    두 회차 모두 탐지된 항목이 없어 해결·신규 여부를 나눌 항목이 없습니다.
                  </p>
                </section>
              )}
              {result.comparisonStatus === "incomplete" && (
                <div role="status" className="rc-warn">
                  <h3 className="font-semibold">
                    {result.resolved.length > 0
                      ? "일부 항목의 해결 판정이 보류되었습니다"
                      : "해결 판정이 보류되었습니다"}
                  </h3>
                  {result.resolved.length > 0 && (
                    <p className="mt-1">
                      검사 근거가 확인된 {result.resolved.length}건은 해결로 구분했습니다. 전체
                      해결률은 산출하지 않습니다.
                    </p>
                  )}
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {result.limitations.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.comparisonStatus !== "empty" && (
                <div className="rc-grid">
                  <section className="rc-card" aria-labelledby="rc-resolved-title">
                    <h3 id="rc-resolved-title" className="text-[#3f5a40]">
                      해결 {result.resolved.length}건
                    </h3>
                    <p className="rc-muted mt-1 text-xs">원본 위치에서 문제가 사라짐</p>
                    {result.resolved.length ? (
                      <ul className="mt-3">
                        {result.resolved.map((change, index) => (
                          <li key={`${change.findingId}-${index}`} className="rc-row">
                            <b>{change.ruleId}</b>
                            <span className="min-w-0">
                              <span className="block font-semibold">
                                {ruleTitle(change.ruleId)}
                              </span>
                              <span className="rc-muted block break-words text-xs leading-5">
                                {where(change)}
                              </span>
                            </span>
                            <span className="rc-row-status">
                              {change.before ? severityLabels[change.before] : "원본 항목"} → 해결
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rc-chip mt-3">해결 0건</p>
                    )}
                  </section>
                  <section className="rc-card" aria-labelledby="rc-remaining-title">
                    <h3 id="rc-remaining-title">
                      남은 항목{" "}
                      {result.new.length +
                        result.regressed.length +
                        result.persisted.length +
                        result.improved.length}
                      건
                    </h3>
                    <ul className="mt-3 space-y-3">
                      {remainingKinds.flatMap(([key, label, description]) =>
                        result[key].map((change, index) => (
                          <li
                            key={`${key}-${change.findingId}-${index}`}
                            className={cn(
                              "rc-alert-card",
                              key === "pending" && "border-[#e3e6e4] bg-[#fffdfc]",
                            )}
                          >
                            <h4 className={cn(key === "pending" && "text-[#526168]")}>
                              <span
                                className={cn(
                                  "rc-tag",
                                  key === "pending" ? "rc-tag--pending" : "rc-tag--new",
                                )}
                              >
                                {label}
                              </span>
                              {change.ruleId} · {ruleTitle(change.ruleId)}
                            </h4>
                            <p>{where(change)}</p>
                            <p className="rc-muted">
                              {key === "pending" && change.verificationNote
                                ? `확인 필요: ${change.verificationNote}`
                                : description}
                            </p>
                            {change.findingId &&
                              key !== "pending" &&
                              audit.findings.some((finding) => finding.id === change.findingId) && (
                                <Link
                                  className="rc-link mt-2 inline-block"
                                  to={`/app/overview?audit=${id}&finding=${encodeURIComponent(change.findingId)}&panel=1`}
                                >
                                  검토하기
                                </Link>
                              )}
                          </li>
                        )),
                      )}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {remainingKinds
                        .filter(([key]) => result[key].length === 0)
                        .map(([key, label]) => (
                          <span key={key} className="rc-chip">
                            {label} 0건
                          </span>
                        ))}
                    </div>
                  </section>
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

export function BenchmarkPage() {
  const summary = useDashboardSummary();
  const [params, setParams] = useSearchParams();
  const requested = params.get("audit");
  const audit =
    summary.data?.audits.find((item) => item.id === (requested ?? summary.data.activeAuditId)) ??
    (!requested ? summary.data?.audits[0] : undefined);
  if (!audit)
    return (
      <div className="rc workspace-page mx-auto max-w-6xl">
        <PageHeading
          eyebrow="BEFORE / AFTER"
          title="전후 비교"
          description="원본과 수정본을 같은 기준으로 비교합니다."
        />
        {summary.isPending ? (
          <p className="mt-6" role="status">
            진단 목록을 불러오는 중입니다.
          </p>
        ) : summary.isError ? (
          <div className="mt-6">
            <p role="alert">진단 목록을 불러오지 못했습니다.</p>
            <Button className="mt-3" onClick={() => void summary.refetch()}>
              다시 불러오기
            </Button>
          </div>
        ) : (
          <p className="mt-6" role="status">
            {requested ? "선택한 진단을 찾을 수 없습니다." : "아직 등록된 진단이 없습니다."}
          </p>
        )}
      </div>
    );
  const id = encodeURIComponent(audit.id);
  // Same container, header and step bar as the result screen it is reached from.
  return (
    <div className="rc overview-page workspace-page mx-auto max-w-[1800px]">
      <AuditFlowHeader
        audit={audit}
        kicker="BEFORE / AFTER"
        pageTitle="전후 비교"
        subtitle="원본과 수정본을 같은 기준으로 비교합니다."
        actions={
          <>
            <CompareControls key={audit.id} audit={audit} />
            <Button asChild variant="outline" className="rc-no-print">
              <Link to={`/app/audits/${id}/recheck`}>
                <RefreshCw size={14} aria-hidden="true" />새 수정본 검사
              </Link>
            </Button>
            <Button variant="outline" className="rc-no-print" onClick={() => window.print()}>
              <FileText size={16} aria-hidden="true" /> PDF 보고서 출력
            </Button>
          </>
        }
      >
        {!audit.demoPreset && (
          <div className="rc-no-print mt-3 max-w-md">
            <label className="sr-only" htmlFor="comparison-audit">
              비교할 진단
            </label>
            <select
              id="comparison-audit"
              className="rc-select"
              value={audit.id}
              onChange={(event) => setParams({ audit: event.target.value })}
            >
              {summary.data?.audits.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </AuditFlowHeader>
      <RecheckSteps audit={audit} current={3} />
      <Comparison key={audit.id} audit={audit} />
    </div>
  );
}
