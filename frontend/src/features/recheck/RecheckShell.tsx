import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import type { AuditDto } from "@/entities/audit/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { baseRun, countByRule, latestRun, ruleTitle } from "./runs";
import { useAuditRun } from "./useRecheckData";

/** Shared layout of the revision step: what to fix, what is submitted, and the run bar. */
export function RecheckShell({
  audit,
  right,
  children,
  canStart,
  busy,
  startLabel,
  onStart,
}: {
  audit: AuditDto;
  right: ReactNode;
  children?: ReactNode;
  canStart: boolean;
  busy: boolean;
  startLabel: string;
  onStart: () => void;
}) {
  const base = baseRun(audit);
  const latest = latestRun(audit);
  const original = useAuditRun(audit.id, base?.version);
  const hasRevision = Boolean(base && latest && latest.version > base.version);
  const nextVersion = Math.max(0, ...(audit.runs ?? []).map((run) => run.version)) + 1;
  const [confirming, setConfirming] = useState(false);
  const rules = countByRule(original.data?.findings ?? []);
  const id = encodeURIComponent(audit.id);

  return (
    <div className="rc">
      <div className="rc-grid">
        <section className="rc-card" aria-labelledby="rc-target-title">
          <p className="rc-eyebrow">고칠 대상 · 원본 v{base?.version ?? 1}</p>
          <h2 id="rc-target-title" className="sr-only">
            고칠 대상
          </h2>
          <p className="rc-big">
            {base?.findingCount ?? 0}
            <span>건</span>
          </p>
          {original.isPending && base ? (
            <p className="rc-muted mt-3 text-sm" role="status">
              원본 결과를 불러오는 중입니다.
            </p>
          ) : rules.length ? (
            <ul className="rc-rule-list" aria-label="규칙별 원본 탐지">
              {rules.map(([ruleId, count]) => (
                <li key={ruleId}>
                  <span>
                    {ruleId} · {ruleTitle(ruleId)}
                  </span>
                  <b>×{count}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rc-muted mt-3 text-sm">원본에서 탐지된 항목이 없습니다.</p>
          )}
          {base && (
            <Link
              className="rc-link mt-4 inline-block"
              to={`/app/overview?audit=${id}&version=${base.version}`}
            >
              원본 결과 다시 보기
            </Link>
          )}
        </section>
        <section className="rc-card" aria-labelledby="rc-revision-title">
          <p className="rc-eyebrow">수정본 화면 · v{nextVersion}</p>
          <h2 id="rc-revision-title" className="sr-only">
            수정본 화면
          </h2>
          {right}
        </section>
      </div>
      {hasRevision && (
        <p className="rc-warn" role="note">
          이미 v{latest!.version} 결과가 있는 진단입니다. 다시 실행하면 v{nextVersion}로 저장되고,
          전후 비교는 계속 v{base!.version} 원본을 기준으로 합니다.
        </p>
      )}
      {children}
      <div className="rc-bar">
        <div>
          <strong>
            v{base?.version ?? 1} 원본 {base?.findingCount ?? 0}건과 비교합니다
          </strong>
          <span>
            같은 규칙 5개 · 같은 화면 {audit.screens.length}개 · 예상 1~2분 · 결과는 v{nextVersion}
            로 저장
          </span>
        </div>
        <button
          type="button"
          className="rc-gold-btn"
          disabled={!canStart || busy}
          onClick={() => (hasRevision ? setConfirming(true) : onStart())}
        >
          {hasRevision && startLabel === "수정본 검사 시작"
            ? "새 수정본으로 다시 검사"
            : startLabel}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={`v${nextVersion}로 다시 검사할까요?`}
          confirmLabel="다시 검사"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onStart();
          }}
        >
          이미 v{latest!.version} 수정본 결과가 있습니다. 새 결과는 v{nextVersion}로 저장되고, 전후
          비교는 v{base!.version} 원본을 기준으로 계속합니다.
        </ConfirmDialog>
      )}
    </div>
  );
}

export function CompletedRevision({ audit, version }: { audit: AuditDto; version?: number }) {
  const id = encodeURIComponent(audit.id);
  return (
    <div className="rc">
      <section className="rc-card mt-5" aria-labelledby="rc-done-title">
        <h2 id="rc-done-title" className="text-lg font-bold">
          수정본 검사가 완료되었습니다
        </h2>
        <p className="rc-muted mt-2 text-sm">원본과 같은 기준으로 다시 검사한 결과입니다.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rc-gold-btn" to={`/app/benchmark?audit=${id}`}>
            전후 비교 보기
          </Link>
          <Link
            className="rc-link self-center"
            to={`/app/overview?audit=${id}${version ? `&version=${version}` : ""}`}
          >
            수정본 결과 보기
          </Link>
        </div>
      </section>
    </div>
  );
}
