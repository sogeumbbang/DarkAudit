import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { saveFindingDecision } from "@/api/audits";
import { Button } from "@/components/ui/Button";
import type { FindingDto } from "@/entities/audit/types";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";

type SavedDecision = { note: string; updatedAt: string | null };

const formatSavedAt = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );

export function FindingDecisionNote({ finding }: { finding: FindingDto }) {
  const inputId = useId();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 대시보드 재조회 전에도 방금 저장한 기록을 바로 보여주기 위한 로컬 사본
  const [savedById, setSavedById] = useState<Record<string, SavedDecision>>({});
  const saved = savedById[finding.id] ?? {
    note: finding.decisionNote ?? "",
    updatedAt: finding.decisionUpdatedAt ?? null,
  };
  const note = drafts[finding.id] ?? "";
  const dirty = note.trim() !== "" && note.trim() !== saved.note;
  const save = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => saveFindingDecision(id, text),
    onSuccess: async (result, variables) => {
      setSavedById((current) => ({
        ...current,
        [variables.id]: { note: result.decisionNote, updatedAt: result.decisionUpdatedAt },
      }));
      setDrafts((current) =>
        current[variables.id] === variables.text ? { ...current, [variables.id]: "" } : current,
      );
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
  const currentSave = save.variables?.id === finding.id;

  return (
    <section className="mt-6 border-t border-border pt-6" aria-label="수정 결정 기록">
      <label className="text-sm font-semibold" htmlFor={inputId}>
        수정 결정 기록
      </label>
      <p className="mt-2 text-xs leading-5 text-muted" id={`${inputId}-help`}>
        이 항목을 어떻게 수정하기로 했는지, 그 이유와 함께 남겨주세요.
      </p>
      {saved.note && (
        <article
          className="mt-3 rounded-card border border-border bg-brand-50 p-4 text-brand-950"
          aria-label="저장된 결정"
        >
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-bold">저장된 결정</h4>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => setDrafts((current) => ({ ...current, [finding.id]: saved.note }))}
            >
              수정
            </Button>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{saved.note}</p>
          {saved.updatedAt && (
            <p className="mt-2 text-xs text-muted">마지막 저장: {formatSavedAt(saved.updatedAt)}</p>
          )}
        </article>
      )}
      <textarea
        id={inputId}
        aria-describedby={`${inputId}-help`}
        className="mt-3 min-h-32 w-full resize-y rounded-control border border-border bg-surface px-3 py-3 text-sm leading-6 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        placeholder={
          saved.note
            ? "새 결정을 입력하고 저장하면 위 기록을 대체합니다."
            : "예: 유료 옵션의 기본 선택을 해제하고, 추가 비용을 옵션 옆에 표시하기로 결정함."
        }
        maxLength={4000}
        value={note}
        onChange={(event) => {
          const value = event.target.value;
          setDrafts((current) => ({ ...current, [finding.id]: value }));
        }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted">
          {note.length.toLocaleString()} / 4,000
        </span>
        <Button
          className="px-4 py-2"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ id: finding.id, text: note })}
        >
          {save.isPending && currentSave ? "저장 중…" : saved.note ? "결정 덮어쓰기" : "결정 저장"}
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted" role="status">
        {dirty
          ? "저장하지 않은 변경사항이 있습니다."
          : saved.note
            ? ""
            : "저장한 기록은 이 점검 항목과 함께 보관됩니다."}
      </p>
      {save.isError && currentSave && (
        <p className="mt-2 text-xs leading-5 text-danger" role="alert">
          저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 저장해주세요.
        </p>
      )}
    </section>
  );
}
