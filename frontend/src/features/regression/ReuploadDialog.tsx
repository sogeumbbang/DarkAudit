import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ImagePlus, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { startAnalysis, uploadAuditScreens } from "@/api/audits";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AuditDto } from "@/entities/audit/types";
import { useAnalysisStatus } from "@/features/audit-create/useAuditWorkflow";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";

import { regressionKeys } from "./useRegression";

const MAX_SCREENS = 6;

/**
 * 기존 진단에 수정본 화면을 올려 새 회차로 분석한다.
 * 업로드(새 회차 생성) → 분석 시작 → 완료되면 비교 화면으로 이동한다.
 */
export function ReuploadDialog({ audit, onClose }: { audit: AuditDto; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<string>();
  const [jobId, setJobId] = useState<string>();

  // 원본의 단계 이름을 순서대로 이어받는다. 수정본도 같은 흐름이기 때문이다.
  const flowSteps = [...audit.screens].sort((a, b) => a.order - b.order).map((s) => s.flowStep);

  const submit = useMutation({
    mutationFn: async () => {
      await uploadAuditScreens({
        auditId: audit.id,
        screens: files.map((file, index) => ({
          id: crypto.randomUUID(),
          flowStep: flowSteps[index] ?? `화면 ${index + 1}`,
          file,
        })),
      });
      return startAnalysis(audit.id);
    },
    onSuccess: (job) => setJobId(job.jobId),
  });
  const status = useAnalysisStatus(jobId);
  const job = status.data;
  const finished = job?.status === "completed" || job?.status === "failed";
  const running = submit.isPending || (Boolean(jobId) && !finished);
  const failed = job?.status === "failed" || submit.isError;

  useEffect(() => {
    if (job?.status !== "completed") return;
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    void queryClient.invalidateQueries({ queryKey: regressionKeys.all });
    navigate(`/app/benchmark?audit=${encodeURIComponent(audit.id)}`);
    onClose();
  }, [job?.status, audit.id, navigate, onClose, queryClient]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, running]);

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const next = [...files, ...Array.from(selected)];
    setMessage(
      next.length > MAX_SCREENS ? `화면은 최대 ${MAX_SCREENS}장까지 올릴 수 있습니다.` : undefined,
    );
    setFiles(next.slice(0, MAX_SCREENS));
    if (inputRef.current) inputRef.current.value = "";
  }

  const errorText =
    submit.error instanceof Error
      ? submit.error.message
      : job?.error || "분석에 실패했습니다. 잠시 후 다시 시도해주세요.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
    >
      <Card
        aria-labelledby="reupload-title"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold" id="reupload-title">
              수정본 다시 올리기
            </h2>
            <p className="mt-1 text-sm text-muted">
              「{audit.name}」에 수정한 화면을 올리면 새 회차로 분석하고, 이전 회차와 비교합니다.
            </p>
          </div>
          <button
            aria-label="닫기"
            className="rounded-control p-2 text-muted hover:bg-black/5 disabled:opacity-40"
            disabled={running}
            type="button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <input
          accept="image/png,image/jpeg,image/webp"
          aria-label="수정본 화면 파일 선택"
          className="sr-only"
          disabled={running}
          multiple
          ref={inputRef}
          type="file"
          onChange={(event) => addFiles(event.target.files)}
        />

        <ol className="mt-5 space-y-2">
          {files.map((file, index) => (
            <li
              className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 text-sm"
              key={`${file.name}-${index}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{file.name}</span>
                <span className="text-xs text-muted">
                  {index + 1}번 · {flowSteps[index] ?? `화면 ${index + 1}`}
                </span>
              </span>
              <button
                aria-label={`${file.name} 삭제`}
                className="p-1 text-danger disabled:opacity-40"
                disabled={running}
                type="button"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ol>

        {files.length < MAX_SCREENS && (
          <Button
            className="mt-3 w-full"
            disabled={running}
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus aria-hidden="true" size={16} />
            {files.length ? "화면 추가" : "수정본 화면 선택 (최대 6장)"}
          </Button>
        )}
        <p className="mt-2 text-xs text-muted">
          원본과 같은 순서로 올려 주세요. 화면 수가 달라도 분석할 수 있습니다.
        </p>

        {message && <p className="mt-3 text-sm text-warning">{message}</p>}

        {running && (
          <div aria-live="polite" className="mt-4 rounded-control bg-brand-50 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-brand-700">
              <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
              {submit.isPending ? "화면을 올리는 중입니다" : "수정본을 분석하고 있습니다"}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-brand-600 transition-[width]"
                style={{ width: `${Math.min(99, job?.progress ?? 5)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">완료되면 비교 화면으로 이동합니다.</p>
          </div>
        )}

        {failed && (
          <p
            className="mt-4 flex items-start gap-2 rounded-control bg-danger/10 p-3 text-sm text-danger"
            role="alert"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            {errorText}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button disabled={running} type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={running || files.length === 0}
            type="button"
            onClick={() => {
              setJobId(undefined);
              submit.reset();
              submit.mutate();
            }}
          >
            분석 시작
          </Button>
        </div>
      </Card>
    </div>
  );
}
