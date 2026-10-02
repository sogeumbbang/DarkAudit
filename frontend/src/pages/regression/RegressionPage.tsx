import { CircleAlert, GitCompareArrows, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { RegressionCard } from "@/features/regression/RegressionCard";
import { ReuploadDialog } from "@/features/regression/ReuploadDialog";
import { useRegression } from "@/features/regression/useRegression";

/** 수정 전·후(회차 간) 비교 화면. `?audit=` 로 진단을 고른다. */
export function RegressionPage() {
  const dashboard = useDashboardSummary();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showUpload, setShowUpload] = useState(false);

  const audits = dashboard.data?.audits ?? [];
  const requested = searchParams.get("audit");
  const audit =
    audits.find((item) => item.id === requested) ??
    audits.find((item) => item.id === dashboard.data?.activeAuditId) ??
    audits[0];
  const regression = useRegression(audit?.id);

  return (
    <div className="mx-auto max-w-4xl">
      <GitCompareArrows aria-hidden="true" className="text-brand-600" size={30} />
      <h1 className="font-display mt-4 text-3xl font-bold">비교 분석</h1>
      <p className="mt-2 text-sm text-muted">
        같은 진단에 수정본을 다시 올리면 이전 회차의 문제가 해결됐는지 비교합니다.
      </p>

      {dashboard.isPending && (
        <Card className="mt-7 p-7 text-sm text-muted">불러오는 중입니다…</Card>
      )}

      {dashboard.isError && (
        <Card className="mt-7 p-7 text-center">
          <CircleAlert className="mx-auto text-danger" size={30} />
          <p className="mt-3 font-semibold">진단 목록을 불러오지 못했습니다</p>
          <Button className="mt-4" variant="outline" onClick={() => dashboard.refetch()}>
            <RefreshCw size={15} /> 다시 시도
          </Button>
        </Card>
      )}

      {dashboard.isSuccess && !audit && (
        <Card className="mt-7 p-7">
          <p className="text-sm text-muted">비교할 진단이 없습니다. 먼저 진단을 만들어 주세요.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/app/audits/new">새 진단 시작하기</Link>
          </Button>
        </Card>
      )}

      {audit && (
        <>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <label className="text-sm font-semibold">
              진단 선택
              <select
                className="mt-1 block w-full min-w-64 rounded-control border border-border bg-white px-3 py-2.5 text-sm font-normal"
                value={audit.id}
                onChange={(event) => setSearchParams({ audit: event.target.value })}
              >
                {audits.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={() => setShowUpload(true)}>
              <Upload aria-hidden="true" size={16} /> 수정본 다시 올리기
            </Button>
          </div>

          {regression.isPending && (
            <Card className="mt-5 p-7 text-sm text-muted">비교 결과를 불러오는 중입니다…</Card>
          )}

          {regression.isError && (
            <Card className="mt-5 p-7 text-center">
              <CircleAlert className="mx-auto text-danger" size={30} />
              <p className="mt-3 font-semibold">비교 결과를 불러오지 못했습니다</p>
              <p className="mt-1 text-sm text-muted">
                {regression.error instanceof Error
                  ? regression.error.message
                  : "잠시 후 다시 시도해주세요."}
              </p>
              <Button className="mt-4" variant="outline" onClick={() => regression.refetch()}>
                <RefreshCw size={15} /> 다시 시도
              </Button>
            </Card>
          )}

          {regression.isSuccess && regression.data === null && (
            <Card className="mt-5 p-7 text-center">
              <p className="font-semibold">아직 재진단 기록이 없습니다</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                수정한 화면을 같은 진단에 다시 올리면 해결·유지·개선·신규·재발 결과를 여기서 볼 수
                있습니다.
              </p>
            </Card>
          )}

          {regression.isSuccess && regression.data && (
            <div className="mt-5">
              <RegressionCard regression={regression.data} />
              <Button asChild className="mt-4" variant="outline">
                <Link to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}>
                  최신 진단 결과 보기
                </Link>
              </Button>
            </div>
          )}

          {showUpload && <ReuploadDialog audit={audit} onClose={() => setShowUpload(false)} />}
        </>
      )}
    </div>
  );
}
