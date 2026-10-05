import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { startAnalysis, uploadAuditScreens } from "@/api/audits";
import { PageHeading } from "@/components/common/PageHeading";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AuditDto } from "@/entities/audit/types";
import { useAnalysisStatus } from "@/features/audit-create/useAuditWorkflow";
import { usePersistedJob } from "@/features/audit-create/usePersistedJob";
import { dashboardKeys, useDashboardSummary } from "@/features/audit-dashboard/useDashboardSummary";
import { DemoRecheckPanel } from "./DemoRecheckPanel";

function RecheckForm({ audit }: { audit: AuditDto }) {
  // Keep the source order fixed while refreshing the dashboard after a new run.
  const [original] = useState(() => [...audit.screens].sort((a, b) => a.order - b.order));
  const [files, setFiles] = useState<Record<string, File>>({});
  const [uploaded, setUploaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = usePersistedJob("recheckJob");
  const lock = useRef(false);
  const queryClient = useQueryClient();
  const job = useAnalysisStatus(jobId);
  const completed = job.data?.status === "completed";
  const failed = job.data?.status === "failed";
  const running = Boolean(jobId && !completed && !failed);
  const existingJob =
    !jobId && !uploaded && (audit.status === "queued" || audit.status === "analyzing");
  const busy = submitting || running || existingJob;
  const canUpload = original.length >= 1 && original.length <= 6;

  useEffect(() => {
    if (completed || failed) {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    }
  }, [completed, failed, queryClient]);

  async function submit() {
    if (lock.current || busy || completed) return;
    if (!canUpload || original.some((screen) => !files[screen.id])) {
      setError("각 단계의 수정본 이미지를 모두 선택해 주세요.");
      return;
    }
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (!uploaded) {
        await uploadAuditScreens({
          auditId: audit.id,
          screens: original.map((screen) => ({
            id: screen.id,
            flowStep: screen.flowStep,
            file: files[screen.id]!,
          })),
        });
        setUploaded(true);
      }
      const nextJob = await startAnalysis(audit.id);
      setJobId(nextJob.jobId);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "재검사를 시작하지 못했습니다.");
    } finally {
      setSubmitting(false);
      lock.current = false;
    }
  }

  if (completed)
    return (
      <Card className="mt-6 p-6">
        <h2 className="text-lg font-bold">수정본 재검사가 완료되었습니다</h2>
        <p className="mt-2 text-sm text-muted">
          비교 화면에서 해결·유지·신규·재발·보류 항목을 확인하세요.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild>
            <Link to={`/app/benchmark?audit=${encodeURIComponent(audit.id)}`}>전후 비교 보기</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}>진단 결과 보기</Link>
          </Button>
        </div>
      </Card>
    );

  return (
    <form
      noValidate
      className="mt-6 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Card className="p-6">
        <h2 className="font-bold">{audit.name}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          기존 화면과 같은 순서로 전체 수정본을 등록합니다. 단계명은 유지되며 같은 진단에 새 회차가
          저장됩니다. PNG·JPG·WEBP, 파일당 최대 10 MiB입니다.
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">
          화면 수·탐색 경로나 분석 근거가 다르면 해결 판정이 보류될 수 있습니다.
        </p>
      </Card>
      {!canUpload && <p role="alert">스크린샷 재검사는 기존 화면이 1~6개인 진단에서 지원합니다.</p>}
      {existingJob && <p role="status">진행 중인 회차가 있습니다. 완료 후 다시 열어 주세요.</p>}
      {canUpload && (
        <fieldset disabled={busy} className="space-y-4">
          <legend className="mb-3 font-semibold">단계별 수정본</legend>
          {original.map((screen, index) => (
            <Card key={screen.id} className="flex flex-wrap items-start gap-4 p-5">
              <img
                className="h-28 w-20 rounded-control border border-border object-contain"
                src={screen.imageUrl}
                alt={`이전 ${index + 1}단계: ${screen.flowStep}`}
              />
              <div className="min-w-0 flex-1 basis-48">
                <label className="block text-sm font-bold" htmlFor={`replacement-${index}`}>
                  {index + 1}. {screen.flowStep} 수정본
                </label>
                <input
                  id={`replacement-${index}`}
                  className="mt-3 block w-full text-sm"
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  required={!uploaded}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setUploaded(false);
                    setJobId(undefined);
                    setError("");
                    const valid =
                      file &&
                      /\.(png|jpe?g|webp)$/i.test(file.name) &&
                      file.size <= 10 * 1024 * 1024;
                    setFiles((current) => {
                      const next = { ...current };
                      if (valid) next[screen.id] = file;
                      else delete next[screen.id];
                      return next;
                    });
                    if (file && !valid) {
                      event.target.value = "";
                      setError("PNG·JPG·WEBP 파일을 10 MiB 이하로 선택해 주세요.");
                    }
                  }}
                />
                {files[screen.id] && (
                  <p className="mt-2 break-all text-xs text-muted">
                    선택됨: {files[screen.id]!.name}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {running && <p role="status">수정본을 분석하고 있습니다. {job.data?.progress ?? 0}%</p>}
      {job.isError && (
        <div role="alert" className="text-sm text-danger">
          작업 상태를 확인하지 못했습니다. 다시 조회해 주세요.
          <Button type="button" variant="outline" onClick={() => void job.refetch()}>
            상태 다시 확인
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert" className="text-sm text-danger">
          분석에 실패했습니다. {job.data?.error} 같은 업로드로 다시 시도할 수 있습니다.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={busy || !canUpload || original.some((screen) => !files[screen.id])}
        >
          {submitting
            ? "재검사 요청 중…"
            : running
              ? "분석 중…"
              : uploaded
                ? "분석 다시 시도"
                : "수정본 재검사 시작"}
        </Button>
        <Button asChild variant="outline">
          <Link to={`/app/overview?audit=${encodeURIComponent(audit.id)}`}>
            진단 결과로 돌아가기
          </Link>
        </Button>
      </div>
    </form>
  );
}

export function AuditRecheckPage() {
  const { auditId } = useParams();
  const summary = useDashboardSummary();
  const audit = summary.data?.audits.find((item) => item.id === auditId);
  return (
    <div className="workspace-page mx-auto max-w-4xl">
      <PageHeading
        eyebrow="REVIEW / RECHECK"
        title="수정본 재검사"
        description="기존 진단에 수정한 화면을 등록하고 변화를 확인하세요."
      />
      {summary.isPending ? (
        <p role="status" className="mt-6">
          진단을 불러오는 중입니다.
        </p>
      ) : summary.isError ? (
        <div className="mt-6">
          <p role="alert">진단을 불러오지 못했습니다.</p>
          <Button className="mt-3" onClick={() => void summary.refetch()}>
            다시 불러오기
          </Button>
        </div>
      ) : audit ? (
        audit.demoPreset ? (
          <DemoRecheckPanel
            key={audit.id}
            audit={audit}
            manualForm={<RecheckForm audit={audit} />}
          />
        ) : (
          <RecheckForm key={audit.id} audit={audit} />
        )
      ) : (
        <p role="alert" className="mt-6">
          진단을 찾을 수 없습니다.
        </p>
      )}
    </div>
  );
}
