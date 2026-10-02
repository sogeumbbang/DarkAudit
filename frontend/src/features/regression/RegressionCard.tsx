import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { RegressionChangeDto, RegressionDto } from "@/entities/audit/types";
import { cn } from "@/lib/cn";

import { ruleTitle } from "./ruleTitle";

type Category = "resolved" | "persisted" | "improved" | "new" | "regressed";

const categories: {
  key: Category;
  label: string;
  hint: string;
  variant: "success" | "neutral" | "progress" | "warning" | "danger";
}[] = [
  { key: "resolved", label: "해결", hint: "이전 회차에 있었고 이번에는 없음", variant: "success" },
  { key: "persisted", label: "유지", hint: "이전과 같은 위험도로 남아 있음", variant: "neutral" },
  { key: "improved", label: "개선", hint: "남아 있지만 위험도가 낮아짐", variant: "progress" },
  { key: "new", label: "신규", hint: "이번 회차에 처음 나타남", variant: "warning" },
  { key: "regressed", label: "재발", hint: "한 번 해결된 뒤 다시 나타남", variant: "danger" },
];

const severityLabel = { HIGH: "높음", REVIEW: "검토 필요", LOW: "낮음" } as const;

function severityText(change: RegressionChangeDto) {
  const before = change.before ? severityLabel[change.before] : null;
  const after = change.after ? severityLabel[change.after] : null;
  if (before && after) return before === after ? before : `${before} → ${after}`;
  return before ?? after ?? "";
}

export function RegressionCard({ regression }: { regression: RegressionDto }) {
  const [selected, setSelected] = useState<Category | null>(null);
  const comparable =
    regression.resolved.length + regression.persisted.length + regression.improved.length;
  const percent = Math.round(regression.resolvedRatio * 100);
  const items = selected ? regression[selected] : [];
  const selectedMeta = categories.find((category) => category.key === selected);

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-muted">
            수정 전·후 비교 · {regression.fromVersion}회차
            <ArrowRight aria-hidden="true" className="mx-1 inline" size={12} />
            {regression.toVersion}회차
          </p>
          <h2 className="font-display mt-1 text-xl font-bold">수정 후 해결 결과</h2>
        </div>
        <div className="text-right" data-testid="resolved-ratio">
          <p className="text-xs font-semibold text-muted">해결률</p>
          <p className="font-display text-4xl font-bold text-brand-600">
            {percent}
            <span className="text-xl">%</span>
          </p>
          <p className="text-xs text-muted">
            이전 회차 문제 {comparable}건 중 {regression.resolved.length}건 해결
          </p>
        </div>
      </div>

      <div
        aria-label="해결률"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="mt-5 h-2 overflow-hidden rounded-full bg-black/5"
        role="progressbar"
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {categories.map(({ key, label, hint, variant }) => {
          const count = regression[key].length;
          const active = selected === key;
          return (
            <li key={key}>
              <button
                aria-pressed={active}
                className={cn(
                  "w-full rounded-control border border-border p-4 text-left transition-colors hover:bg-brand-50",
                  active && "border-brand-600 bg-brand-50",
                )}
                title={hint}
                type="button"
                onClick={() => setSelected(active ? null : key)}
              >
                <Badge variant={variant}>{label}</Badge>
                <p className="font-display mt-2 text-3xl font-bold">
                  {count}
                  <span className="ml-0.5 text-sm font-medium text-muted">건</span>
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && selectedMeta && (
        <section aria-label={`${selectedMeta.label} 항목`} className="mt-5">
          <p className="text-xs text-muted">{selectedMeta.hint}</p>
          {items.length === 0 ? (
            <p className="mt-3 rounded-control border border-dashed border-border p-4 text-sm text-muted">
              해당하는 항목이 없습니다.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-control border border-border">
              {items.map((change, index) => (
                <li
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  key={`${change.ruleId}-${change.findingId ?? index}`}
                >
                  <span>
                    <span className="font-semibold">{change.ruleId}</span>{" "}
                    <span className="text-muted">{ruleTitle(change.ruleId)}</span>
                  </span>
                  <span className="text-xs text-muted">{severityText(change)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Card>
  );
}
