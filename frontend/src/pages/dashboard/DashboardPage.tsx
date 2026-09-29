import { ArrowUpRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { dashboardMetrics, productLabels, reviewStatus } from "./dashboard";

export function DashboardPage() {
  const { data, isPending, isError, refetch } = useDashboardSummary();
  const audits = [...(data?.audits ?? [])].sort(
    (a, b) =>
      new Date(b.createdAt ?? b.updatedAt).getTime() -
      new Date(a.createdAt ?? a.updatedAt).getTime(),
  );
  const metrics = dashboardMetrics(audits);
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-7">
        <div>
          <p className="mb-4 font-mono text-xs tracking-[0.08em] text-muted">
            DARKAUDIT / WORKSPACE
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            대시보드
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted">
            여러 진단의 진행 상태와 검토 결과를 한곳에서 관리하세요.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link to="/app/audits/new">
            <Plus size={16} aria-hidden="true" /> 새 진단 시작
          </Link>
        </Button>
      </div>
      {isPending ? (
        <p role="status" className="mt-8">
          진단 현황을 불러오는 중입니다.
        </p>
      ) : isError ? (
        <Card className="mt-8 space-y-4 p-8">
          <p role="alert">진단 현황을 불러오지 못했습니다.</p>
          <Button onClick={() => refetch()} variant="outline">
            다시 시도
          </Button>
        </Card>
      ) : (
        <>
          <dl
            aria-label="진단 현황"
            className="grid grid-cols-2 border-b border-border bg-surface lg:grid-cols-4"
          >
            {[
              ["전체 진단", metrics.total, "등록된 진단 수"],
              ["검토 필요", metrics.needsReview, "미해결 후보 또는 추가 확인"],
              ["검토 완료", metrics.reviewed, "분석 완료 · 미해결 후보 없음"],
              ["위험 후보 수", metrics.candidates, "해결된 항목을 포함한 전체 후보"],
            ].map(([label, value, description]) => (
              <div
                key={label}
                className="border-r border-border p-5 last:border-r-0 sm:p-6 [&:nth-child(2)]:border-r-0 [&:nth-child(-n+2)]:border-b lg:[&:nth-child(2)]:border-r lg:[&:nth-child(-n+2)]:border-b-0"
              >
                <dt className="text-sm font-medium text-muted">{label}</dt>
                <dd className="mt-5 text-4xl font-medium tracking-tight tabular-nums text-brand-700 sm:text-5xl">
                  {value}
                  <span className="ml-1 text-sm font-normal text-muted">건</span>
                </dd>
                <dd className="mt-3 break-keep text-sm leading-6 text-muted">{description}</dd>
              </div>
            ))}
          </dl>
          <Card className="mt-10 overflow-hidden border-x-0 border-t-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-5">
              <h2 className="font-semibold">진단 목록</h2>
              <Link
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
                to="/app/audits"
              >
                진단 기록 보기 <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
            {!audits.length ? (
              <div className="p-8 text-center">
                <p className="text-muted">아직 등록된 진단이 없습니다.</p>
                <Link
                  className="mt-4 inline-block font-semibold text-brand-700"
                  to="/app/audits/new"
                >
                  새 진단 만들기 →
                </Link>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-border sm:hidden" aria-label="진단 목록">
                  {audits.map((audit) => (
                    <li key={audit.id} className="py-5">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          className="min-w-0 break-words font-semibold underline-offset-4 hover:underline"
                          to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}
                        >
                          {audit.name}
                        </Link>
                        <span className="shrink-0 rounded-control bg-brand-50 px-2 py-1 text-xs">
                          {reviewStatus(audit)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-muted">
                        {audit.productType ? productLabels[audit.productType] : "미지정"} · 위험
                        후보 {audit.findings.length}건
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {audit.createdAt
                          ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
                              new Date(audit.createdAt),
                            )
                          : "생성일 기록 없음"}
                      </p>
                    </li>
                  ))}
                </ul>
                <div
                  className="hidden overflow-x-auto sm:block"
                  role="region"
                  aria-label="진단 목록 표"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="bg-background text-muted">
                      <tr>
                        {["프로젝트", "상품 유형", "생성일", "위험 후보", "상태"].map((label) => (
                          <th className="px-6 py-4 font-medium" scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {audits.map((audit) => {
                        const status = reviewStatus(audit);
                        return (
                          <tr key={audit.id} className="hover:bg-brand-50/40">
                            <td className="max-w-80 px-6 py-5">
                              <Link
                                className="break-words font-semibold text-brand-700 hover:underline"
                                to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}
                              >
                                {audit.name}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-6 py-5">
                              {audit.productType ? productLabels[audit.productType] : "미지정"}
                            </td>
                            <td className="whitespace-nowrap px-6 py-5">
                              {audit.createdAt
                                ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
                                    new Date(audit.createdAt),
                                  )
                                : "기록 없음"}
                            </td>
                            <td className="px-6 py-5 tabular-nums">{audit.findings.length}건</td>
                            <td className="whitespace-nowrap px-6 py-5">
                              <Badge
                                variant={
                                  status === "검토 완료"
                                    ? "success"
                                    : status === "분석 실패"
                                      ? "danger"
                                      : ["검토 필요", "추가 확인 필요"].includes(status)
                                        ? "warning"
                                        : "neutral"
                                }
                              >
                                {status}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
