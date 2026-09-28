import { ArrowRight, ChartNoAxesColumn, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { AuditDto } from "@/entities/audit/types";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { useDeleteAudit } from "@/features/audit-dashboard/useDeleteAudit";

export { GuidelinesPage } from "./GuidelinesPage";

export function BenchmarkPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <ChartNoAxesColumn className="text-brand-600" size={30} />
      <h1 className="mt-4 text-3xl font-bold">비교 분석</h1>
      <Card className="mt-7 p-7">
        <h2 className="font-bold">수정 전·후 결과 비교</h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          동일 진단에서 화면을 다시 등록하면 회차별 탐지 항목의 해결·유지·재발 여부를 비교할 수
          있습니다.
        </p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/app/overview">
            진단 결과 선택 <ArrowRight size={16} />
          </Link>
        </Button>
      </Card>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Settings className="text-brand-600" size={30} />
      <h1 className="mt-4 text-3xl font-bold">설정</h1>
      <Card className="mt-7 p-7">
        <h2 className="flex items-center gap-2 font-bold">
          <ShieldCheck size={20} /> 데모 운영 모드
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          업로드 이미지는 진단 근거로만 사용하며, 서버의 AI provider와 모델 설정은 배포 환경에서
          관리됩니다.
        </p>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-control bg-brand-50 p-4">
            <dt className="text-muted">이미지 입력</dt>
            <dd className="mt-1 font-semibold">최대 6장</dd>
          </div>
          <div className="rounded-control bg-brand-50 p-4">
            <dt className="text-muted">지원 방식</dt>
            <dd className="mt-1 font-semibold">URL · Screenshot · Figma</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function AuditRow({ audit }: { audit: AuditDto }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteAudit();

  return (
    <li className="flex flex-wrap items-center justify-between gap-5 px-6 py-6 sm:px-8">
      <div className="min-w-0 flex-1 basis-64">
        <div className="mb-3">
          <Badge
            variant={
              audit.status === "completed"
                ? "success"
                : audit.status === "failed"
                  ? "danger"
                  : "neutral"
            }
          >
            {
              {
                draft: "준비 중",
                queued: "대기 중",
                analyzing: "진단 중",
                completed: "완료",
                failed: "실패",
              }[audit.status]
            }
          </Badge>
        </div>
        <Link
          className="break-words text-base font-semibold hover:underline"
          to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}
        >
          {audit.name}
        </Link>
        <p className="mt-2 text-sm leading-6 text-muted">
          {{ "mobile-web": "모바일 웹", "desktop-web": "데스크톱 웹", app: "앱" }[audit.platform]} ·
          화면 {audit.screens.length}개 · 탐지 {audit.findings.length}건
        </p>
        <p className="mt-1 text-xs leading-6 text-muted">
          검토 필요 {audit.findings.filter((finding) => finding.status !== "resolved").length}건 ·
          해결됨 {audit.findings.filter((finding) => finding.status === "resolved").length}건
        </p>
        <p className="mt-2 text-xs text-muted">
          최근 수정 ·{" "}
          {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(audit.updatedAt),
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          className="inline-flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}
          aria-label={`${audit.name} 상세 결과`}
        >
          상세 결과 <ArrowRight size={15} />
        </Link>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-danger">화면과 탐지 결과가 함께 삭제됩니다.</span>
            <Button
              className="px-3 py-2 text-xs"
              disabled={remove.isPending}
              onClick={() => remove.mutate(audit.id)}
            >
              {remove.isPending ? "삭제 중" : "삭제"}
            </Button>
            <Button
              className="px-3 py-2 text-xs"
              disabled={remove.isPending}
              onClick={() => setConfirming(false)}
              variant="outline"
            >
              취소
            </Button>
          </div>
        ) : (
          <Button
            aria-label={`${audit.name} 삭제`}
            className="flex items-center gap-2 px-3 py-2 text-xs"
            onClick={() => setConfirming(true)}
            variant="outline"
          >
            <Trash2 size={14} /> 삭제
          </Button>
        )}
      </div>
    </li>
  );
}

export function AuditManagementPage() {
  const { data, isPending, isError, refetch } = useDashboardSummary();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">진단 기록</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            진행한 진단을 최신순으로 확인하고, 선택한 진단의 상세 결과를 열어보세요.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/audits/new">
            새 진단 시작 <ArrowRight size={16} />
          </Link>
        </Button>
      </div>

      <Card className="mt-8 overflow-hidden">
        <h2 className="border-b border-border px-6 py-5 text-sm font-bold sm:px-8">
          전체 진단{data ? ` · ${data.audits.length}건` : ""}
        </h2>
        {isPending && <p className="px-6 py-8 text-sm text-muted">불러오는 중입니다.</p>}
        {isError && (
          <div className="space-y-4 px-6 py-8">
            <p className="text-sm text-danger">진단 목록을 불러오지 못했습니다.</p>
            <Button variant="outline" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        )}
        {data && data.audits.length === 0 && (
          <p className="px-6 py-8 text-sm text-muted">아직 등록된 진단이 없습니다.</p>
        )}
        {data && data.audits.length > 0 && (
          <ul className="divide-y divide-border">
            {[...data.audits]
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
              .map((audit) => (
                <AuditRow audit={audit} key={audit.id} />
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
