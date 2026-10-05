import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { getAuditRegression } from "@/api/audits";
import { PageHeading } from "@/components/common/PageHeading";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AuditDto } from "@/entities/audit/types";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { DemoJourney } from "@/features/audit-create/DemoJourney";
import { guidelineCategories } from "./guidelines";

const groups = [
  ["resolved", "해결", "이전 항목이 동일 검사 범위에서 더 이상 탐지되지 않았습니다."],
  ["persisted", "유지", "동일 항목이 이번에도 탐지되었습니다."],
  ["improved", "개선", "동일 항목이 남아 있으나 심각도가 낮아졌습니다."],
  ["new", "신규", "이번 회차에 새로 탐지되었습니다."],
  ["regressed", "재발", "과거 해결 기록이 있는 항목이 다시 탐지되었습니다."],
  ["pending", "보류", "이전 항목이 보이지 않지만 해결을 확인할 근거가 부족합니다."],
] as const;
const ruleNames = new Map(
  guidelineCategories.flatMap((category) => category.types.map((rule) => [rule.id, rule.title])),
);
const severityLabels = { HIGH: "높음", REVIEW: "검토 필요", LOW: "낮음" };

function Comparison({ audit }: { audit: AuditDto }) {
  const completed = (audit.runs ?? [])
    .filter((run) => run.status === "completed")
    .sort((a, b) => a.version - b.version);
  const previous = completed.at(-2);
  const current = completed.at(-1);
  const comparison = useQuery({
    queryKey: ["regression", audit.id, previous?.version, current?.version, audit.updatedAt],
    queryFn: () => getAuditRegression(audit.id, previous!.version, current!.version),
    enabled: Boolean(previous && current),
    retry: false,
  });
  const result = comparison.data;
  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}>진단 결과 보기</Link>
        </Button>
        {!audit.demoPreset && (
          <Button asChild>
            <Link to={`/app/audits/${encodeURIComponent(audit.id)}/recheck`}>수정본 재검사</Link>
          </Button>
        )}
      </div>
      {(audit.status === "queued" || audit.status === "analyzing" || audit.status === "failed") && (
        <p className="text-sm text-muted">
          최신 작업은 {audit.status === "failed" ? "실패했습니다" : "진행 중입니다"}. 비교에는
          완료된 회차만 사용합니다.
        </p>
      )}
      {!previous || !current ? (
        <Card className="p-6">
          <h2 className="font-bold">비교할 완료 회차가 부족합니다</h2>
          <p className="mt-2 text-sm text-muted">
            같은 진단에 수정본을 등록해 두 회차 이상 분석을 완료해 주세요.
          </p>
        </Card>
      ) : comparison.isPending ? (
        <p role="status">비교 결과를 불러오는 중입니다.</p>
      ) : comparison.isError ? (
        <Card className="p-6">
          <p role="alert">비교 결과를 불러오지 못했습니다. {comparison.error.message}</p>
          <Button className="mt-3" onClick={() => void comparison.refetch()}>
            다시 불러오기
          </Button>
        </Card>
      ) : result ? (
        <>
          <Card className="p-6">
            <h2 className="text-lg font-bold">
              v{result.fromVersion} → v{result.toVersion} 비교
            </h2>
            <p className="mt-2 text-sm text-muted">최신 완료 두 회차 · {audit.name}</p>
            <p className="mt-3 font-semibold">
              탐지 항목 {previous.findingCount}건 → {current.findingCount}건
            </p>
            <p className="mt-4 text-xl font-bold">
              해결률 ·{" "}
              {result.comparisonStatus === "incomplete" || result.resolvedRatio === null
                ? "산출 보류"
                : `${Math.round(result.resolvedRatio * 100)}%`}
            </p>
            <p className="mt-2 text-xs text-muted">
              이전 항목 중 해결된 비율입니다. 신규·재발 항목은 분모에 포함하지 않습니다.
            </p>
            {result.comparisonStatus === "incomplete" && (
              <div role="status" className="mt-4 rounded-control bg-brand-50 p-4">
                <h3 className="font-semibold">
                  {result.resolved.length > 0
                    ? "일부 항목의 해결 판정이 보류되었습니다"
                    : "해결 판정이 보류되었습니다"}
                </h3>
                {result.resolved.length > 0 && (
                  <p className="mt-2 text-sm">
                    검사 근거가 확인된 {result.resolved.length}건은 해결로 구분했습니다. 전체
                    해결률은 산출하지 않습니다.
                  </p>
                )}
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {result.limitations.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map(([key, label, description]) => (
              <Card key={key} className="min-w-0 p-6">
                <h3 className="font-bold">
                  {label} · {result[key].length}건
                </h3>
                <p className="mt-2 text-xs leading-5 text-muted">{description}</p>
                {result[key].length === 0 ? (
                  <p className="mt-4 text-sm text-muted">해당 항목 없음</p>
                ) : (
                  <ul className="mt-4 space-y-4">
                    {result[key].map((change, index) => (
                      <li
                        key={`${change.findingId}-${index}`}
                        className="border-t border-border pt-3 text-sm"
                      >
                        <p className="font-semibold">
                          {change.ruleId} · {ruleNames.get(change.ruleId) ?? "검토 항목"}
                        </p>
                        <p className="mt-1 text-muted">
                          이전: {change.before ? severityLabels[change.before] : "항목 없음"} →
                          이번:{" "}
                          {change.after
                            ? severityLabels[change.after]
                            : key === "pending"
                              ? "확인 보류"
                              : "미탐지"}
                        </p>
                        {change.findingId &&
                          audit.findings.some((finding) => finding.id === change.findingId) && (
                            <Link
                              className="mt-2 inline-block text-brand-700 underline"
                              to={`/app/overview?audit=${encodeURIComponent(audit.id)}&finding=${encodeURIComponent(change.findingId)}&panel=1`}
                            >
                              현재 항목 검토
                            </Link>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </>
      ) : null}
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
  return (
    <div className="workspace-page mx-auto max-w-6xl">
      <PageHeading
        eyebrow="REVIEW / COMPARISON"
        title="비교 분석"
        description="수정 전후의 최신 완료 두 회차를 비교합니다."
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
        <>
          {audit?.demoPreset ? (
            <DemoJourney step={3} />
          ) : (
            <>
              <label className="mt-6 block text-sm font-semibold" htmlFor="comparison-audit">
                비교할 진단
              </label>
              <select
                id="comparison-audit"
                className="mt-2 w-full rounded-control border border-border bg-surface p-3 text-sm"
                value={audit?.id ?? ""}
                onChange={(event) => setParams({ audit: event.target.value })}
              >
                <option value="" disabled>
                  진단 선택
                </option>
                {summary.data?.audits.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {audit ? (
            <Comparison key={audit.id} audit={audit} />
          ) : (
            <p className="mt-6" role="status">
              {requested ? "선택한 진단을 찾을 수 없습니다." : "아직 등록된 진단이 없습니다."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
