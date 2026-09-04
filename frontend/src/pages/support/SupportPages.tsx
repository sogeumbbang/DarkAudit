import {
  ArrowRight,
  BookOpen,
  ChartNoAxesColumn,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AuditDto } from "@/entities/audit/types";
import { useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { useDeleteAudit } from "@/features/audit-dashboard/useDeleteAudit";

const rules = [
  ["오도형", "중요 정보를 사실과 다르게 인식시키는 표현과 선택 구조"],
  ["방해형", "합리적인 비교, 취소 또는 다음 단계 진행을 어렵게 만드는 구조"],
  ["압박형", "불안·손실·긴급성을 강조해 특정 선택을 유도하는 표현"],
  ["편취 유도형", "가격이나 선택 비용을 늦게 공개하거나 시각적으로 숨기는 구조"],
];

export function GuidelinesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-xs font-bold uppercase tracking-widest text-brand-600">검토 기준</p>
      <h1 className="mt-2 text-3xl font-bold">금융 다크패턴 4개 범주</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        금융위원회 온라인 금융상품 판매 관련 가이드라인의 15개 유형을 구조화해 검사합니다.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {rules.map(([title, description]) => (
          <Card className="p-6" key={title}>
            <BookOpen className="text-brand-600" size={24} />
            <h2 className="mt-4 font-bold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
          </Card>
        ))}
      </div>
      <Button asChild className="mt-8">
        <Link to="/app/audits/new">새 진단 시작 <ArrowRight size={16} /></Link>
      </Button>
    </div>
  );
}

export function BenchmarkPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <ChartNoAxesColumn className="text-brand-600" size={30} />
      <h1 className="mt-4 text-3xl font-bold">비교 분석</h1>
      <Card className="mt-7 p-7">
        <h2 className="font-bold">수정 전·후 결과 비교</h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          동일 진단에서 화면을 다시 등록하면 회차별 탐지 항목의 해결·유지·재발 여부를 비교할 수 있습니다.
        </p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/app/overview">진단 결과 선택 <ArrowRight size={16} /></Link>
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
        <h2 className="flex items-center gap-2 font-bold"><ShieldCheck size={20} /> 데모 운영 모드</h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          업로드 이미지는 진단 근거로만 사용하며, 서버의 AI provider와 모델 설정은 배포 환경에서 관리됩니다.
        </p>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-control bg-brand-50 p-4"><dt className="text-muted">이미지 입력</dt><dd className="mt-1 font-semibold">최대 5장</dd></div>
          <div className="rounded-control bg-brand-50 p-4"><dt className="text-muted">지원 방식</dt><dd className="mt-1 font-semibold">URL · Screenshot · Figma</dd></div>
        </dl>
      </Card>
    </div>
  );
}

function AuditRow({ audit }: { audit: AuditDto }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteAudit();

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
      <div className="min-w-0">
        <Link className="font-semibold hover:underline" to={`/app/overview?audit=${audit.id}`}>
          {audit.name}
        </Link>
        <p className="mt-1 text-xs text-muted">
          화면 {audit.screens.length}개 · 탐지 {audit.findings.length}건 ·{" "}
          {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(audit.updatedAt),
          )}
        </p>
      </div>
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
    </li>
  );
}

export function AuditManagementPage() {
  const { data, isPending, isError } = useDashboardSummary();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-3xl font-bold">진단 관리</h1>
      <p className="mt-3 text-sm text-muted">기존 진단을 열어보거나 정리하고, 새 진단을 시작하세요.</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <Card className="p-6"><h2 className="font-bold">기존 진단</h2><p className="mt-2 text-sm text-muted">수집된 화면과 탐지 결과를 확인합니다.</p><Button asChild className="mt-5" variant="outline"><Link to="/app/overview">대시보드 열기</Link></Button></Card>
        <Card className="p-6"><h2 className="font-bold">새 진단</h2><p className="mt-2 text-sm text-muted">URL 또는 스크린샷으로 검사를 시작합니다.</p><Button asChild className="mt-5"><Link to="/app/audits/new">진단 만들기</Link></Button></Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <h2 className="border-b border-border px-6 py-4 text-sm font-bold">등록된 진단</h2>
        {isPending && <p className="px-6 py-8 text-sm text-muted">불러오는 중입니다.</p>}
        {isError && (
          <p className="px-6 py-8 text-sm text-danger">진단 목록을 불러오지 못했습니다.</p>
        )}
        {data && data.audits.length === 0 && (
          <p className="px-6 py-8 text-sm text-muted">아직 등록된 진단이 없습니다.</p>
        )}
        {data && data.audits.length > 0 && (
          <ul className="divide-y divide-border">
            {data.audits.map((audit) => (
              <AuditRow audit={audit} key={audit.id} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
