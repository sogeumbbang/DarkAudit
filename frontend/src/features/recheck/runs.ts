import type { RegressionDto } from "@/api/schemas";
import type { AuditDto, AuditRunDto } from "@/entities/audit/types";
import { guidelineCategories } from "@/pages/support/guidelines";

const ruleTitles = new Map(
  guidelineCategories.flatMap((category) => category.types.map((rule) => [rule.id, rule.title])),
);

export function ruleTitle(ruleId: string) {
  return ruleTitles.get(ruleId) ?? "검토 항목";
}

export function completedRuns(audit: AuditDto) {
  return (audit.runs ?? [])
    .filter((run) => run.status === "completed")
    .sort((a, b) => a.version - b.version);
}

/** The first completed run is the original every revision is compared against. */
export function baseRun(audit: AuditDto) {
  return completedRuns(audit)[0];
}

export function latestRun(audit: AuditDto) {
  return completedRuns(audit).at(-1);
}

export function isRevision(audit: AuditDto, run: AuditRunDto | undefined) {
  const base = baseRun(audit);
  return Boolean(run && base && run.version > base.version);
}

export function runKind(audit: AuditDto, run: AuditRunDto) {
  if (!isRevision(audit, run)) return "원본";
  return run.variant === "partial" ? "일부 수정본" : "수정본";
}

export function runLabel(audit: AuditDto, run: AuditRunDto) {
  return `v${run.version} ${runKind(audit, run)}`;
}

/** Demo audits carry the variant they started from in their name. */
export function displayName(name: string) {
  return name.replace(/\s*·\s*(문제 포함 원본|일부 수정본|전체 개선본)$/, "");
}

export function countByRule(items: { ruleId: string }[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.ruleId, (counts.get(item.ruleId) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function screenNumber(screenId: string) {
  const match = /(\d+)$/.exec(screenId);
  return match ? match[1]!.padStart(2, "0") : screenId;
}

// Prepared revisions are fixed demo assets; the result still comes from analysis.
export const demoRevisionNotes = [
  "미리 체크된 특약·광고 동의 해제",
  "필수 비용을 첫 화면부터 함께 표시",
  "동의·거절 버튼을 같은 크기로 정리",
  "작은 회색 조건 문구를 읽을 수 있는 크기로",
  "압박·죄책감 문구를 중립적 안내로 교체",
];

export type ScreenChange = RegressionDto["screenChanges"][number];

export const changeWords: Record<ScreenChange["status"], string> = {
  resolved: "해결",
  reduced: "감소",
  persisted: "유지",
  new: "신규",
  clear: "변화 없음",
};

export function screenChangeLabel(change: ScreenChange) {
  if (change.status === "clear") return "탐지 없음";
  return `${change.beforeCount} → ${change.afterCount} · ${changeWords[change.status]}`;
}

/** The screen whose finding count moved the most; ties keep flow order. */
export function largestChange(changes: ScreenChange[]) {
  let best: ScreenChange | undefined;
  for (const change of changes) {
    const delta = Math.abs(change.beforeCount - change.afterCount);
    if (delta && (!best || delta > Math.abs(best.beforeCount - best.afterCount))) best = change;
  }
  return best;
}
