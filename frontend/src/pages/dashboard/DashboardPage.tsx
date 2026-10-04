import { ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeading } from "@/components/common/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { dashboardMetrics, productLabels, reviewStatus } from "./dashboard";

import "./dashboard.css";

export function DashboardPage() {
  const { data, isPending, isError, refetch } = useDashboardSummary();
  const audits = [...(data?.audits ?? [])].sort(
    (a, b) =>
      new Date(b.createdAt ?? b.updatedAt).getTime() -
      new Date(a.createdAt ?? a.updatedAt).getTime(),
  );
  const metrics = dashboardMetrics(audits);
  const focusAudit =
    audits.find(
      (audit) =>
        audit.screens.length && audit.findings.some((finding) => finding.status !== "resolved"),
    ) ?? audits.find((audit) => audit.screens.length);
  const focusFinding = focusAudit?.findings.find((finding) => finding.status !== "resolved");
  const focusScreen =
    focusAudit?.screens.find(
      (screen) => screen.id === (focusFinding?.bbox?.screenId ?? focusFinding?.screenIds[0]),
    ) ?? focusAudit?.screens[0];
  const focusLink = focusAudit
    ? `/app/overview?audit=${encodeURIComponent(focusAudit.id)}${focusFinding ? `&finding=${encodeURIComponent(focusFinding.id)}` : ""}`
    : "/app/audits/new";
  return (
    <div className="workspace-page dashboard-page mx-auto max-w-6xl">
      <PageHeading
        eyebrow="01 / YOUR WORKSPACE"
        title="대시보드"
        description="여러 진단의 진행 상태와 검토 결과를 한곳에서 관리하세요."
        action={
          <Button asChild>
            <Link to="/app/audits/new">
              <Plus size={16} aria-hidden="true" /> 새 진단 시작
            </Link>
          </Button>
        }
      />
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
          {focusAudit && focusScreen ? (
            <section className="dashboard-focus" aria-labelledby="continue-review-title">
              <div className="dashboard-focus-copy">
                <p className="editorial-label">
                  01 / {focusFinding ? "CONTINUE REVIEWING" : "LATEST ANALYSIS"}
                </p>
                <h2 id="continue-review-title">
                  {focusFinding ? (
                    <>
                      좋은 경험을 위한,
                      <br />
                      다음 검토.
                    </>
                  ) : (
                    <>
                      검토의 기록을,
                      <br />
                      한눈에.
                    </>
                  )}
                </h2>
                <p className="dashboard-focus-project">{focusAudit.name}</p>
                <p className="dashboard-focus-description">
                  {focusFinding
                    ? focusFinding.title
                    : "화면별 분석 결과와 검토 기록을 다시 살펴보세요."}
                </p>
                <Button asChild>
                  <Link to={focusLink}>
                    {focusFinding ? "이어서 검토하기" : "분석 결과 보기"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </Button>
                <p className="dashboard-focus-meta">
                  화면 {focusAudit.screens.length}개 <span>·</span> 검토 필요{" "}
                  {focusAudit.findings.filter((finding) => finding.status !== "resolved").length}건
                </p>
              </div>
              <Link
                to={focusLink}
                className="dashboard-focus-preview"
                aria-label={`${focusAudit.name} 화면 검토 열기`}
              >
                <div>
                  <span>SCREEN {String(focusScreen.order).padStart(2, "0")}</span>
                  <span>
                    {focusScreen.flowStep}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </span>
                </div>
                <img src={focusScreen.imageUrl} alt={`${focusScreen.flowStep} 검토할 화면`} />
                <p>{focusFinding ? "화면 속 근거부터 살펴보세요." : "분석한 화면과 검토 기록"}</p>
              </Link>
            </section>
          ) : !audits.length ? (
            <section className="dashboard-empty" aria-labelledby="first-review-title">
              <p className="editorial-label">YOUR FIRST REVIEW</p>
              <h2 id="first-review-title">
                더 나은 선택을 만드는
                <br />첫 화면을 등록하세요.
              </h2>
              <p>URL, Figma, APK 또는 스크린샷으로 시작할 수 있습니다.</p>
              <Link to="/app/audits/new">
                첫 진단 시작하기 <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </section>
          ) : null}
          <dl aria-label="진단 현황" className="dashboard-metrics">
            {[
              ["전체 진단", metrics.total, "등록된 진단 수"],
              ["검토 필요", metrics.needsReview, "미해결 후보 또는 추가 확인"],
              ["검토 완료", metrics.reviewed, "분석 완료 · 미해결 후보 없음"],
              ["위험 후보 수", metrics.candidates, "해결된 항목을 포함한 전체 후보"],
            ].map(([label, value, description]) => (
              <div key={label} className="dashboard-metric">
                <dt className="text-sm font-medium text-muted">{label}</dt>
                <dd className="dashboard-metric-value">
                  {value}
                  <span className="ml-1 text-sm font-normal text-muted">건</span>
                </dd>
                <dd className="dashboard-metric-description">{description}</dd>
              </div>
            ))}
          </dl>
          <section className="dashboard-records mt-12">
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
          </section>
        </>
      )}
    </div>
  );
}
