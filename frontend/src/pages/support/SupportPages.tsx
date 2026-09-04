import { ArrowRight, BookOpen, ChartNoAxesColumn, Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

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

export function AuditManagementPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-3xl font-bold">진단 관리</h1>
      <p className="mt-3 text-sm text-muted">대시보드에서 기존 진단을 확인하거나 새 진단을 시작하세요.</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <Card className="p-6"><h2 className="font-bold">기존 진단</h2><p className="mt-2 text-sm text-muted">수집된 화면과 탐지 결과를 확인합니다.</p><Button asChild className="mt-5" variant="outline"><Link to="/app/overview">대시보드 열기</Link></Button></Card>
        <Card className="p-6"><h2 className="font-bold">새 진단</h2><p className="mt-2 text-sm text-muted">URL 또는 스크린샷으로 검사를 시작합니다.</p><Button asChild className="mt-5"><Link to="/app/audits/new">진단 만들기</Link></Button></Card>
      </div>
    </div>
  );
}
