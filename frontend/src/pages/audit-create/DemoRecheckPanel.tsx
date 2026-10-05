import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  analyzeAndroidApp,
  importFigmaAudit,
  captureAuditUrl,
  startAnalysis,
  uploadAuditScreens,
} from "@/api/audits";
import { demoGoal, getDemoApk, getDemoInputs, getDemoScreens } from "@/api/demo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AuditDto, DemoVariant } from "@/entities/audit/types";
import { useAnalysisStatus } from "@/features/audit-create/useAuditWorkflow";
import { usePersistedJob } from "@/features/audit-create/usePersistedJob";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";
import { DemoJourney } from "@/features/audit-create/DemoJourney";
import { AnalysisProgress } from "./AnalysisProgress";

export function DemoRecheckPanel({ audit }: { audit: AuditDto }) {
  const catalog = useQuery({ queryKey: ["demo-inputs"], queryFn: getDemoInputs, retry: false });
  const variant = "revised";
  const [uploadedVariant, setUploadedVariant] = useState<DemoVariant>();
  const [jobId, setJobId] = usePersistedJob("demoJob");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const client = useQueryClient();
  const job = useAnalysisStatus(jobId);
  const completed =
    job.data?.status === "completed" ||
    (audit.demoVariant === "revised" &&
      audit.status === "completed" &&
      (audit.runs ?? []).filter((run) => run.status === "completed").length >= 2);
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
        throw new Error("데모 수정본이 준비되지 않았습니다.");
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

  if (jobId && !completed) {
    return (
      <AnalysisProgress
        source={preset.source}
        auditId={audit.id}
        progress={job.data?.progress ?? 0}
        completed={false}
        failed={failed || job.isError}
        error={job.data?.error ?? job.error?.message}
        demo
        demoStep={2}
        exploration={
          job.data?.explorationMode
            ? {
                mode: job.data.explorationMode,
                stage: job.data.explorationStage,
                events: job.data.explorationEvents ?? [],
              }
            : undefined
        }
        onBack={() => setJobId(undefined)}
      />
    );
  }

  return (
    <Card className="mt-6 space-y-5 p-6">
      <DemoJourney step={2} />
      {completed ? (
        <>
          <h2 className="text-lg font-bold">수정본 분석이 완료되었습니다</h2>
          <p className="text-sm leading-6 text-muted">원본과 수정본의 검사 결과를 비교해 보세요.</p>
          <Button asChild>
            <Link to={`/app/benchmark?audit=${encodeURIComponent(audit.id)}`}>비교하기</Link>
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-lg font-bold">준비된 수정본을 검사합니다</h2>
          <p className="text-sm leading-6 text-muted">
            기본 체크, 비용 공개, 선택 버튼과 안내 문구를 개선한 수정본입니다. 파일이나 설정을
            바꾸지 않고 바로 실행할 수 있습니다.
          </p>
          <p className="text-xs leading-5 text-muted">
            개선 여부는 실제 검사 결과와 확인된 근거를 바탕으로 비교합니다.
          </p>
          {catalog.isPending && <p role="status">수정본을 준비하고 있습니다.</p>}
          {catalog.isError && (
            <div role="alert">
              수정본을 불러오지 못했습니다.
              <Button variant="outline" onClick={() => void catalog.refetch()}>
                다시 불러오기
              </Button>
            </div>
          )}
          {!catalog.isPending && !catalog.isError && !available && (
            <p role="alert">이 데모의 수정본이 아직 준비되지 않았습니다.</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {busy && !pending && (
            <p role="status">원본 검사가 완료되면 수정본을 실행할 수 있습니다.</p>
          )}
          <Button disabled={busy || !available} onClick={() => void run()}>
            {pending ? "수정본 준비 중…" : "수정본 실행해보기"}
          </Button>
        </>
      )}
    </Card>
  );
}
