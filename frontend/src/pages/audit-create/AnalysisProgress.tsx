import { ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, ScanLine } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { AuditSource } from "@/pages/audit-create/AuditSourceFields";

const TIPS = [
  {
    title: "문구와 선택 구조를 함께 살펴봅니다",
    text: "같은 안내도 버튼의 크기와 배치에 따라 선택에 미치는 영향이 달라질 수 있습니다.",
  },
  {
    title: "기본 선택 상태도 점검 대상입니다",
    text: "선택 동의나 부가 서비스가 미리 체크되어 있는지 확인하는 규칙이 포함됩니다.",
  },
  {
    title: "중요 정보의 가독성을 살펴봅니다",
    text: "비용과 위험 안내가 작거나 흐리게 표시되는지도 화면 점검의 대상입니다.",
  },
  {
    title: "결과는 화면의 근거와 함께 확인합니다",
    text: "탐지된 항목은 위치와 관찰 근거, 관련 가이드라인, 개선 권고안으로 제공됩니다.",
  },
  {
    title: "확인하지 못한 부분은 구분합니다",
    text: "캡처되지 않은 단계나 근거가 부족한 항목은 추가 검토가 필요할 수 있습니다.",
  },
];

export function AnalysisProgress({
  source,
  auditId,
  progress,
  completed,
  failed,
  error,
  onBack,
}: {
  source: AuditSource;
  auditId?: string;
  progress: number;
  completed: boolean;
  failed: boolean;
  error?: string | null;
  onBack: () => void;
}) {
  const running = !completed && !failed;
  const [startedAt] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const tipIndex = Math.floor(elapsed / 7) % TIPS.length;
  const tip = TIPS[tipIndex]!;
  const shownProgress = completed
    ? 100
    : Math.max(0, Math.min(99, Number.isFinite(progress) ? Math.round(progress) : 0));
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const workingTitle = {
    website: "사이트를 캡처하고 분석하고 있습니다",
    figma: "Figma 프레임과 레이어를 분석하고 있습니다",
    android: "Android 앱을 실행하고 탐색하고 있습니다",
    screenshots: "등록한 화면을 분석하고 있습니다",
  }[source];

  return (
    <div className="mx-auto max-w-3xl py-10">
      <Card className="overflow-hidden p-8 text-center sm:p-12">
        {running ? (
          <div
            aria-hidden="true"
            className="relative mx-auto flex size-24 items-center justify-center overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-b from-brand-50 to-brand-100"
          >
            <ScanLine size={44} strokeWidth={1.3} className="text-brand-600" />
            <div className="analysis-scan-line absolute inset-x-3 top-3 h-px bg-brand-500 shadow-[0_0_12px_2px_#5da18855]" />
          </div>
        ) : (
          <span
            className={cn(
              "mx-auto flex size-16 items-center justify-center rounded-full",
              completed ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
            )}
          >
            {completed ? <CheckCircle2 size={32} /> : <CircleAlert size={32} />}
          </span>
        )}
        <div role="status" aria-live="polite" aria-atomic="true">
          <h1 className="mt-6 text-2xl font-bold">
            {completed
              ? "진단이 완료되었습니다"
              : failed
                ? "진단을 완료하지 못했습니다"
                : workingTitle}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {completed
              ? "수집한 화면과 AI 진단 결과를 대시보드에서 확인할 수 있습니다."
              : failed
                ? (error ?? "연동 설정과 서버 로그를 확인해주세요.")
                : "아직 분석 중입니다. 완료되면 ‘결과 확인하기’ 버튼이 나타납니다."}
          </p>
        </div>
        {!failed && (
          <div className="mx-auto mt-8 max-w-lg">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-2 text-brand-700">
                {running && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                    size={14}
                  />
                )}
                {running ? "분석 진행 중" : "분석 완료"}
              </span>
              <strong>{shownProgress}%</strong>
            </div>
            <div
              role="progressbar"
              aria-label="진단 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={shownProgress}
              className="mt-3 h-2 overflow-hidden rounded-full bg-brand-100"
            >
              <div
                className="relative h-full overflow-hidden rounded-full bg-brand-600 transition-[width] duration-700 motion-reduce:transition-none"
                style={{ width: `${shownProgress}%` }}
              >
                {running && (
                  <div
                    aria-hidden="true"
                    className="analysis-progress-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                  />
                )}
              </div>
            </div>
          </div>
        )}
        {running && (
          <>
            <div className="mx-auto mt-5 flex max-w-lg items-center justify-between text-xs text-muted">
              <span>이 화면에서 기다려 주세요</span>
              <span>
                경과 시간{" "}
                <span
                  role="timer"
                  aria-label="경과 시간"
                  aria-live="off"
                  className="ml-1 font-semibold tabular-nums text-brand-900"
                >
                  {elapsedLabel}
                </span>
              </span>
            </div>
            <div className="mx-auto mt-7 min-h-32 max-w-lg rounded-card border border-brand-100 bg-brand-50 p-5 text-left">
              <div key={tipIndex} className="analysis-tip-enter">
                <p className="text-xs font-semibold text-brand-600">진단 안내</p>
                <p className="mt-2 text-sm font-bold text-brand-900">{tip.title}</p>
                <p className="mt-2 text-xs leading-5 text-muted">{tip.text}</p>
              </div>
            </div>
            {elapsed >= 60 && (
              <p className="mx-auto mt-4 max-w-lg text-xs leading-5 text-muted">
                화면 수와 외부 서비스 연결 상태에 따라 시간이 더 걸릴 수 있습니다. 완료되면 이
                화면에서 결과를 안내합니다.
              </p>
            )}
          </>
        )}
        {completed && (
          <Button asChild className="mt-9">
            <Link to={`/app/overview?audit=${auditId}`}>
              결과 확인하기 <ArrowRight size={16} />
            </Link>
          </Button>
        )}
        {failed && (
          <Button className="mt-9" variant="outline" onClick={onBack}>
            입력 화면으로 돌아가기
          </Button>
        )}
      </Card>
    </div>
  );
}
