import { Link } from "react-router-dom";

import type { AuditDto, AuditRunDto, AuditScreenDto } from "@/entities/audit/types";
import type { RegressionDto } from "@/api/schemas";
import { cn } from "@/lib/cn";
import {
  changeWords,
  completedRuns,
  screenChangeLabel,
  countByRule,
  isRevision,
  ruleTitle,
  runKind,
  runLabel,
  screenNumber,
  type ScreenChange,
} from "./runs";

export function ScreenChangeTag({ change }: { change: ScreenChange }) {
  return (
    <span className={cn("rc-tag", `rc-tag--${change.status}`)}>{screenChangeLabel(change)}</span>
  );
}

export function RunBadge({ audit, run }: { audit: AuditDto; run: AuditRunDto }) {
  return (
    <span className={cn("rc-badge", isRevision(audit, run) && "rc-badge--revised")}>
      {runLabel(audit, run)}
    </span>
  );
}

export function RunSwitch({ audit, current }: { audit: AuditDto; current: number }) {
  const runs = completedRuns(audit);
  if (runs.length < 2) return null;
  return (
    <nav className="rc-switch" aria-label="회차 전환">
      {runs.map((run) => (
        <Link
          key={run.id}
          to={`/app/overview?audit=${encodeURIComponent(audit.id)}&version=${run.version}`}
          aria-current={run.version === current ? "page" : undefined}
        >
          {runLabel(audit, run)} {run.findingCount}건
        </Link>
      ))}
    </nav>
  );
}

function remainingOf(regression: RegressionDto) {
  return [
    ...regression.new.map((change) => ({ change, kind: "신규" })),
    ...regression.regressed.map((change) => ({ change, kind: "재발" })),
    ...regression.persisted.map((change) => ({ change, kind: "유지" })),
    ...regression.improved.map((change) => ({ change, kind: "개선" })),
  ];
}

function findingScreen(audit: AuditDto, findingId?: string | null) {
  const finding = audit.findings.find((item) => item.id === findingId);
  const screenId = finding?.bbox?.screenId ?? finding?.screenIds[0];
  return screenId ? screenNumber(screenId) : undefined;
}

export function RevisionMetrics({
  audit,
  base,
  run,
  regression,
}: {
  audit: AuditDto;
  base: AuditRunDto;
  run: AuditRunDto;
  regression: RegressionDto;
}) {
  const remaining = remainingOf(regression);
  const first = remaining[0];
  const firstScreen = first && findingScreen(audit, first.change.findingId);
  const resolved = regression.resolved.length;
  return (
    <section className="rc rc-kpis" aria-label="원본 대비 결과">
      <div className="rc-kpi rc-kpi--navy">
        <p>원본 대비 탐지</p>
        <p className="rc-kpi-value">
          {base.findingCount} → {run.findingCount}
          <small>건</small>
        </p>
        <p className="rc-kpi-note">
          v{base.version} {runKind(audit, base)} → v{run.version} {runKind(audit, run)}
        </p>
      </div>
      <div className="rc-kpi rc-kpi--resolved">
        <p>해결</p>
        <p className="rc-kpi-value">
          {resolved}
          <small>건</small>
        </p>
        <p className="rc-kpi-note">
          {resolved && resolved === base.findingCount
            ? "원본 항목 전부"
            : `원본 ${base.findingCount}건 중${regression.pending.length ? ` · 보류 ${regression.pending.length}건` : ""}`}
        </p>
      </div>
      <div className={cn("rc-kpi", remaining.length && "rc-kpi--risk")}>
        <p>새로 확인 필요</p>
        <p className="rc-kpi-value">
          {remaining.length}
          <small>건</small>
        </p>
        <p className="rc-kpi-note rc-muted">
          {first
            ? `${firstScreen ? `화면 ${firstScreen} · ` : ""}${first.change.ruleId} ${first.kind}${remaining.length > 1 ? ` 외 ${remaining.length - 1}건` : ""}`
            : "수정본에 남은 항목 없음"}
        </p>
      </div>
      <div className="rc-kpi">
        <p>등록 화면</p>
        <p className="rc-kpi-value">
          {audit.screens.length}
          <small>개</small>
        </p>
        <p className="rc-kpi-note rc-muted">원본과 같은 순서로 비교</p>
      </div>
    </section>
  );
}

export function BeforeAfterPreview({
  screen,
  original,
  change,
  base,
  run,
}: {
  screen: AuditScreenDto;
  original?: AuditScreenDto;
  change?: ScreenChange;
  base: AuditRunDto;
  run: AuditRunDto;
}) {
  const after = change
    ? change.status === "resolved"
      ? `해결 ${change.beforeCount}`
      : change.status === "reduced"
        ? `${change.afterCount}건 · 해결 ${change.beforeCount - change.afterCount}`
        : change.status === "clear"
          ? "탐지 없음"
          : `${changeWords[change.status]} ${change.afterCount}건`
    : `${screen.findingCount}건`;
  return (
    <section className="rc rc-card" aria-label="원본과 수정본 화면 비교">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">
          {screenNumber(screen.id)} {screen.flowStep}
        </h3>
        {change && <ScreenChangeTag change={change} />}
      </div>
      <div className="rc-compare">
        <figure>
          {original ? (
            <img src={original.imageUrl} alt={`v${base.version} 원본 ${screen.flowStep}`} />
          ) : (
            <div className="rc-muted grid h-64 place-items-center text-sm">원본 화면 없음</div>
          )}
          <figcaption>
            v{base.version} 원본 · {change?.beforeCount ?? original?.findingCount ?? 0}건
          </figcaption>
        </figure>
        <figure>
          <img src={screen.imageUrl} alt={`v${run.version} 수정본 ${screen.flowStep}`} />
          <figcaption className={cn(change?.status === "resolved" && "text-[#3f5a40]")}>
            v{run.version} 수정본 · {after}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function ChangePanel({
  audit,
  regression,
  onReview,
}: {
  audit: AuditDto;
  regression: RegressionDto;
  onReview: (findingId: string) => void;
}) {
  const remaining = remainingOf(regression);
  const resolvedByRule = countByRule(regression.resolved);
  return (
    <aside className="rc rc-card space-y-4" aria-labelledby="rc-change-title">
      <h2 id="rc-change-title" className="text-lg font-bold">
        원본 대비 변화
      </h2>
      {remaining.length ? (
        <ul className="space-y-3" aria-label="수정본에 남은 항목">
          {remaining.map(({ change, kind }, index) => {
            const screen = findingScreen(audit, change.findingId);
            const reviewable = audit.findings.some((item) => item.id === change.findingId);
            return (
              <li key={`${change.findingId}-${index}`} className="rc-alert-card">
                <h4>
                  <span className="rc-tag rc-tag--new">{kind}</span>
                  {change.ruleId} · {ruleTitle(change.ruleId)}
                </h4>
                <p>
                  {screen && <b>화면 {screen} · </b>}
                  {[change.location, change.element].filter(Boolean).join(" · ") ||
                    "수정본에서 탐지된 항목입니다."}
                </p>
                {reviewable && (
                  <button
                    type="button"
                    className="rc-link mt-2"
                    onClick={() => onReview(change.findingId!)}
                  >
                    검토하기
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rc-muted text-sm">수정본에 남은 항목이 없습니다.</p>
      )}
      {regression.pending.length > 0 && (
        <p className="rc-chip">근거 부족으로 보류 {regression.pending.length}건</p>
      )}
      <div>
        <h3 className="text-sm font-bold text-[#3f5a40]">해결 {regression.resolved.length}건</h3>
        {resolvedByRule.length ? (
          <ul className="rc-resolved-list mt-2">
            {resolvedByRule.map(([ruleId, count]) => (
              <li key={ruleId}>
                <span>
                  {ruleId} · {ruleTitle(ruleId)}
                </span>
                <b>×{count} 해결</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rc-muted mt-1 text-xs">해결로 확인된 원본 항목이 없습니다.</p>
        )}
      </div>
      <Link
        className="rc-link inline-block"
        to={`/app/benchmark?audit=${encodeURIComponent(audit.id)}`}
      >
        전후 비교에서 자세히 보기
      </Link>
    </aside>
  );
}
