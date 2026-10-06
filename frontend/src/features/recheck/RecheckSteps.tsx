import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { AuditDto } from "@/entities/audit/types";
import { cn } from "@/lib/cn";
import { baseRun, latestRun } from "./runs";

function Step({
  to,
  state,
  mark,
  title,
  note,
}: {
  to?: string;
  state: "done" | "current" | "next" | "locked";
  mark: ReactNode;
  title: string;
  note: string;
}) {
  const body = (
    <>
      <span className="rc-step-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="rc-step-copy">
        <strong>{title}</strong>
        <span>{note}</span>
      </span>
    </>
  );
  const className = cn("rc-step", `is-${state}`);
  if (to && state !== "locked" && state !== "current")
    return (
      <Link className={className} to={to}>
        {body}
      </Link>
    );
  return (
    <div
      className={className}
      aria-current={state === "current" ? "step" : undefined}
      aria-disabled={state === "locked" || undefined}
    >
      {body}
    </div>
  );
}

/** Original → revision → comparison, each step opening its own screen. */
export function RecheckSteps({ audit, current }: { audit: AuditDto; current: 1 | 2 | 3 }) {
  const base = baseRun(audit);
  const latest = latestRun(audit);
  const hasRevision = Boolean(base && latest && latest.version > base.version);
  const id = encodeURIComponent(audit.id);
  return (
    <nav aria-label="수정본 검사 단계">
      <ol className="rc-steps">
        <li>
          <Step
            to={base ? `/app/overview?audit=${id}&version=${base.version}` : undefined}
            state={current === 1 ? "current" : base ? "done" : "next"}
            mark={base && current !== 1 ? <Check size={14} /> : "1"}
            title="원본 검사"
            note={base ? `v${base.version} 완료 · ${base.findingCount}건` : "원본 검사 전"}
          />
        </li>
        <li>
          <Step
            to={`/app/audits/${id}/recheck`}
            state={current === 2 ? "current" : hasRevision ? "done" : "next"}
            mark={hasRevision && current !== 2 ? <Check size={14} /> : "2"}
            title="수정본 검사"
            note={
              hasRevision
                ? `v${latest!.version} 완료 · ${latest!.findingCount}건`
                : "같은 기준으로 검사"
            }
          />
        </li>
        <li>
          <Step
            to={`/app/benchmark?audit=${id}`}
            state={current === 3 ? "current" : hasRevision ? "next" : "locked"}
            mark="3"
            title="전후 비교"
            note={hasRevision ? "원본 대비 변화 보기" : "수정본 검사 후 열림"}
          />
        </li>
      </ol>
    </nav>
  );
}
