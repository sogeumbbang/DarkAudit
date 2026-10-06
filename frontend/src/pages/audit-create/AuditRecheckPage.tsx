import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { FileSearch, GitCompareArrows } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { startAnalysis, uploadAuditScreens } from "@/api/audits";
import { PageHeading } from "@/components/common/PageHeading";
import { Button } from "@/components/ui/Button";
import { AuditFlowHeader } from "@/features/recheck/AuditFlowHeader";
import { RecheckSteps } from "@/features/recheck/RecheckSteps";
import { CompletedRevision, RecheckShell } from "@/features/recheck/RecheckShell";
import { baseRun, latestRun } from "@/features/recheck/runs";
import "@/features/recheck/recheck.css";
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
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewUrls = useRef(previews);
  useEffect(() => {
    previewUrls.current = previews;
  }, [previews]);
  useEffect(
    () => () => Object.values(previewUrls.current).forEach((url) => URL.revokeObjectURL(url)),
    [],
  );

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

  if (completed) return <CompletedRevision audit={audit} version={latestRun(audit)?.version} />;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <RecheckShell
        audit={audit}
        canStart={canUpload && original.every((screen) => files[screen.id])}
        busy={busy}
        startLabel={
          submitting
            ? "재검사 요청 중…"
            : running
              ? "분석 중…"
              : uploaded
                ? "분석 다시 시도"
                : "수정본 검사 시작"
        }
        onStart={() => void submit()}
        right={
          <>
            <h3 className="mt-1 font-bold">단계별 수정본 업로드</h3>
            <p className="rc-muted mt-1 text-xs leading-5">
              기존 화면과 같은 순서로 등록합니다. PNG·JPG·WEBP, 파일당 최대 10 MiB. 화면 수나 순서가
              다르면 해결 판정이 보류될 수 있습니다.
            </p>
            {!canUpload && (
              <p role="alert" className="mt-3 text-sm">
                스크린샷 재검사는 기존 화면이 1~6개인 진단에서 지원합니다.
              </p>
            )}
            {canUpload && (
              <fieldset disabled={busy} className="mt-3 space-y-3">
                <legend className="sr-only">단계별 수정본</legend>
                {original.map((screen, index) => (
                  <div key={screen.id} className="flex items-start gap-3">
                    <img
                      className="h-20 w-12 flex-none rounded border border-[#e3e6e4] bg-white object-cover object-top"
                      src={previews[screen.id] ?? screen.imageUrl}
                      alt={`${previews[screen.id] ? "수정본" : "이전"} ${index + 1}단계: ${screen.flowStep}`}
                    />
                    <div className="min-w-0 flex-1">
                      <label className="block text-sm font-bold" htmlFor={`replacement-${index}`}>
                        {index + 1}. {screen.flowStep} 수정본
                      </label>
                      <input
                        id={`replacement-${index}`}
                        className="mt-2 block w-full text-xs"
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
                          setPreviews((current) => {
                            const next = { ...current };
                            if (next[screen.id]) URL.revokeObjectURL(next[screen.id]!);
                            if (valid) next[screen.id] = URL.createObjectURL(file);
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
                        <p className="mt-1 break-all text-xs text-muted">
                          선택됨: {files[screen.id]!.name}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </fieldset>
            )}
          </>
        }
      >
        {existingJob && (
          <p role="status" className="mt-4 text-sm">
            진행 중인 회차가 있습니다. 완료 후 다시 열어 주세요.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
        {running && (
          <p role="status" className="mt-4 text-sm">
            수정본을 분석하고 있습니다. {job.data?.progress ?? 0}%
          </p>
        )}
        {job.isError && (
          <div role="alert" className="mt-4 text-sm text-danger">
            작업 상태를 확인하지 못했습니다. 다시 조회해 주세요.
            <Button type="button" variant="outline" onClick={() => void job.refetch()}>
              상태 다시 확인
            </Button>
          </div>
        )}
        {failed && (
          <p role="alert" className="mt-4 text-sm text-danger">
            분석에 실패했습니다. {job.data?.error} 같은 업로드로 다시 시도할 수 있습니다.
          </p>
        )}
      </RecheckShell>
    </form>
  );
}

function RecheckHeaderActions({ audit }: { audit: AuditDto }) {
  const base = baseRun(audit);
  const latest = latestRun(audit);
  const id = encodeURIComponent(audit.id);
  return (
    <>
      {base && (
        <Button asChild variant="outline">
          <Link to={`/app/overview?audit=${id}&version=${base.version}`}>
            <FileSearch size={15} aria-hidden="true" />
            원본 결과 보기
          </Link>
        </Button>
      )}
      {base && latest && latest.version > base.version && (
        <Button asChild className="overview-demo-next">
          <Link to={`/app/benchmark?audit=${id}`}>
            <GitCompareArrows size={15} aria-hidden="true" />
            전후 비교
          </Link>
        </Button>
      )}
    </>
  );
}

export function AuditRecheckPage() {
  const { auditId } = useParams();
  const summary = useDashboardSummary();
  const audit = summary.data?.audits.find((item) => item.id === auditId);
  if (!audit)
    return (
      <div className="workspace-page mx-auto max-w-6xl">
        <PageHeading
          eyebrow="RECHECK"
          title="수정본 검사"
          description="원본과 같은 기준으로 다시 검사합니다"
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
        ) : (
          <p role="alert" className="mt-6">
            진단을 찾을 수 없습니다.
          </p>
        )}
      </div>
    );
  // Same container, header and step bar as the result and comparison screens.
  return (
    <div className="rc overview-page workspace-page mx-auto max-w-[1800px]">
      <AuditFlowHeader
        audit={audit}
        kicker="RECHECK"
        pageTitle="수정본 검사"
        subtitle="원본과 같은 기준으로 다시 검사합니다"
        actions={<RecheckHeaderActions audit={audit} />}
      />
      <RecheckSteps audit={audit} current={2} />
      {audit.demoPreset ? (
        <DemoRecheckPanel key={audit.id} audit={audit} />
      ) : (
        <RecheckForm key={audit.id} audit={audit} />
      )}
    </div>
  );
}
