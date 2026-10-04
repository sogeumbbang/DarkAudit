import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  analyzeAndroidApp,
  importFigmaAudit,
  captureAuditUrl,
  startAnalysis,
  uploadAuditScreens,
} from "@/api/audits";
import { demoGoal, demoVariantLabels, getDemoApk, getDemoInputs, getDemoScreens } from "@/api/demo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AuditDto, DemoVariant } from "@/entities/audit/types";
import { useAnalysisStatus } from "@/features/audit-create/useAuditWorkflow";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";

export function DemoRecheckPanel({
  audit,
  manualForm,
}: {
  audit: AuditDto;
  manualForm: ReactNode;
}) {
  const catalog = useQuery({ queryKey: ["demo-inputs"], queryFn: getDemoInputs, retry: false });
  const [variant, setVariant] = useState<DemoVariant>(
    audit.demoVariant === "partial" ? "revised" : "partial",
  );
  const [uploadedVariant, setUploadedVariant] = useState<DemoVariant>();
  const [jobId, setJobId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const lock = useRef(false);
  const client = useQueryClient();
  const job = useAnalysisStatus(jobId);
  const completed = job.data?.status === "completed";
  const failed = job.data?.status === "failed";
  const running = Boolean(jobId && !completed && !failed);
  const busy =
    pending ||
    running ||
    (!jobId && !uploadedVariant && ["queued", "analyzing"].includes(audit.status));
  const preset = audit.demoPreset!;
  const demo = catalog.data?.cases.find((item) => item.id === preset.scenario);
  const selected = ["screenshots", "website"].includes(preset.source)
    ? demo?.variants.find((item) => item.id === variant)
    : undefined;
  const figma = preset.source === "figma" ? catalog.data?.figma : undefined;
  const figmaVariant = figma?.variants.find((item) => item.id === variant);
  const android = preset.source === "android" ? catalog.data?.android : undefined;
  const androidVariant = android?.variants.find((item) => item.id === variant);
  const available = Boolean(
    selected ||
    (figma?.available && figmaVariant?.available) ||
    (android?.available && androidVariant?.available),
  );

  useEffect(() => {
    if (completed || failed) void client.invalidateQueries({ queryKey: dashboardKeys.all });
  }, [completed, failed, client]);

  async function run() {
    if (!available || busy || lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      let nextJob;
      if (figma && figmaVariant) {
        nextJob = await importFigmaAudit({
          auditId: audit.id,
          fileUrl: figma.fileUrl,
          target: audit.platform,
          selectionMode: "prototype-flow",
          flowName: figmaVariant.flowName,
          demoVariant: variant,
        });
      } else if (androidVariant) {
        const appFile = await getDemoApk(androidVariant.downloadUrl);
        nextJob = await analyzeAndroidApp({
          auditId: audit.id,
          appFile,
          goal: "다음 버튼으로 6단계 최종 이용료까지 확인",
          demoVariant: variant,
        });
      } else if (preset.source === "website" && selected) {
        nextJob = await captureAuditUrl({
          auditId: audit.id,
          url: selected.websiteUrl,
          profiles: ["mobile"],
          mode: "smart",
          goal: demoGoal,
          demoVariant: variant,
        });
      } else if (selected) {
        if (uploadedVariant !== variant) {
          const screens = await getDemoScreens(selected);
          await uploadAuditScreens({ auditId: audit.id, screens, demoVariant: variant });
          setUploadedVariant(variant);
        }
        nextJob = await startAnalysis(audit.id);
      } else {
        throw new Error("선택한 데모 수정본이 준비되지 않았습니다.");
      }
      setJobId(nextJob.jobId);
      void client.invalidateQueries({ queryKey: dashboardKeys.all });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "데모 수정본 실행에 실패했습니다.");
    } finally {
      setPending(false);
      lock.current = false;
    }
  }

  if (manual) return <>{manualForm}</>;
  return (
    <Card className="mt-6 space-y-5 p-6">
      <h2 className="text-lg font-bold">데모 수정본 실행</h2>
      <p className="text-sm leading-6 text-muted">
        {preset.source === "android" ? "모아 소액투자" : (demo?.name ?? preset.scenario)} ·{" "}
        {
          {
            website: "URL 자동 탐색",
            screenshots: "스크린샷",
            figma: "Figma 프로토타입",
            android: "APK 자동 탐색",
          }[preset.source]
        }
        . 같은 진단에 새 회차를 추가합니다. 별도 파일을 준비하지 않아도 됩니다.
      </p>
      {audit.demoVariant && (
        <p className="text-sm">최근 등록한 데모: {demoVariantLabels[audit.demoVariant]}</p>
      )}
      <label className="block text-sm font-semibold" htmlFor="demo-update-variant">
        실행할 수정본
      </label>
      <select
        id="demo-update-variant"
        className="w-full rounded-control border border-border bg-surface p-3"
        value={variant}
        disabled={busy}
        onChange={(event) => {
          setVariant(event.target.value as DemoVariant);
          setJobId(undefined);
          setUploadedVariant(undefined);
          setError("");
        }}
      >
        {Object.entries(demoVariantLabels).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <p className="text-sm leading-6 text-muted">
        {variant === "risky"
          ? "사전 선택·숨겨진 조건·버튼 위계·감정적 압박·필수 비용 후공개가 있는 원본입니다."
          : variant === "partial"
            ? "선택 항목의 기본 체크를 해제하고 필수 비용을 처음부터 공개합니다. 버튼 위계·작은 조건·압박 문구는 남겨둡니다."
            : "기본 체크와 비용 공개에 더해 선택 버튼의 비중, 조건 가독성, 압박 문구와 반복 동의까지 개선했습니다."}
      </p>
      <p className="text-xs leading-5 text-muted">
        실제 분석으로 결과를 확인합니다. ‘전체 개선본’도 탐지 0건이나 해결률 100%를 보장하지 않으며,
        검사 근거가 부족하면 비교를 보류합니다.
      </p>
      {selected && (
        <section aria-label="선택한 데모 수정본 미리보기">
          <h3 className="text-sm font-semibold">
            {selected.label} · {selected.screens.length}개 화면
          </h3>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {selected.screens.map((screen, index) => (
              <a
                key={screen.url}
                href={screen.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-control border border-border bg-surface p-2 text-xs hover:border-brand-500"
                aria-label={`${index + 1}. ${screen.flowStep} ${selected.label} 이미지 열기 (새 탭)`}
              >
                <img
                  src={screen.url}
                  alt={`${screen.flowStep} ${selected.label}`}
                  className="h-28 w-full object-contain"
                  loading="lazy"
                />
                <span className="mt-2 block">
                  {index + 1}. {screen.flowStep}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
      {figma && figmaVariant && (
        <a
          className="block text-sm underline"
          href={figma.fileUrl}
          target="_blank"
          rel="noreferrer"
        >
          Figma에서 {figmaVariant.flowName} 확인 (새 탭)
        </a>
      )}
      {androidVariant && (
        <a className="block text-sm underline" href={androidVariant.downloadUrl} download>
          APK {androidVariant.label} 다운로드
        </a>
      )}
      {catalog.isPending && <p role="status">데모 파일 목록을 불러오는 중입니다.</p>}
      {catalog.isError && (
        <div role="alert">
          데모 목록을 불러오지 못했습니다.
          <Button variant="outline" onClick={() => void catalog.refetch()}>
            데모 목록 다시 확인
          </Button>
        </div>
      )}
      {!catalog.isPending && !catalog.isError && !available && (
        <p role="alert">이 데모의 수정본 파일이 준비되지 않았습니다.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {running && <p role="status">데모 수정본을 분석하고 있습니다. {job.data?.progress ?? 0}%</p>}
      {busy && !running && !pending && (
        <p role="status">진행 중인 회차가 있습니다. 완료 후 다시 열어 주세요.</p>
      )}
      {job.isError && (
        <div role="alert">
          작업 상태를 확인하지 못했습니다.
          <Button variant="outline" onClick={() => void job.refetch()}>
            상태 다시 확인
          </Button>
        </div>
      )}
      {failed && <p role="alert">분석에 실패했습니다. {job.data?.error}</p>}
      {completed ? (
        <div className="space-y-4">
          <h3 className="font-bold">데모 수정본 분석이 완료되었습니다</h3>
          <Button asChild>
            <Link to={`/app/benchmark?audit=${encodeURIComponent(audit.id)}`}>전후 비교 보기</Link>
          </Button>
          {variant !== "revised" && (
            <Button
              className="ml-2"
              variant="outline"
              onClick={() => {
                setVariant("revised");
                setJobId(undefined);
                setUploadedVariant(undefined);
              }}
            >
              전체 개선본 선택
            </Button>
          )}
        </div>
      ) : (
        <Button disabled={busy || !available} onClick={() => void run()}>
          {pending ? "데모 준비 중…" : running ? "분석 중…" : "선택한 데모 수정본 실행"}
        </Button>
      )}
      {!busy && !jobId && (
        <div>
          <Button variant="outline" onClick={() => setManual(true)}>
            내 파일로 재검사
          </Button>
        </div>
      )}
    </Card>
  );
}
