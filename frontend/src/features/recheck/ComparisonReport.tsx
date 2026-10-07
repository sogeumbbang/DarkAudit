import { brandLogo } from "@/components/common/brandLogo";
import type { RegressionDto } from "@/api/schemas";
import type { AuditDto, AuditRunDto, AuditScreenDto } from "@/entities/audit/types";
import { ReportDialog } from "@/features/audit-report/ReportDialog";
import { displayName, ruleTitle, runLabel, screenChangeLabel, screenNumber } from "./runs";

type Change = RegressionDto["resolved"][number];

const severity = { HIGH: "위험 높음", REVIEW: "검토 필요", LOW: "낮음" };
const remainingKinds = [
  ["new", "신규"],
  ["regressed", "재발"],
  ["persisted", "유지"],
  ["improved", "개선"],
  ["pending", "보류"],
] as const;

function where(change: Change) {
  return [change.location, change.element].filter(Boolean).join(" · ") || "위치 정보 없음";
}

function ChangeEntry({ change, label, number }: { change: Change; label: string; number: number }) {
  return (
    <section className="audit-report-finding">
      <h3>
        {number}. {ruleTitle(change.ruleId)} ({change.ruleId})
      </h3>
      <p className="audit-report-finding-meta">
        {label} · {change.before ? severity[change.before] : "원본 항목 없음"} →{" "}
        {change.after ? severity[change.after] : label}
      </p>
      <p>{where(change)}</p>
      {change.verificationNote && (
        <p>
          <strong>확인 필요: </strong>
          {change.verificationNote}
        </p>
      )}
    </section>
  );
}

/** Same print preview and document style as the audit report, for a before/after pair. */
export function ComparisonReport({
  audit,
  from,
  to,
  result,
  fromScreens,
  toScreens,
  onClose,
}: {
  audit: AuditDto;
  from: AuditRunDto;
  to: AuditRunDto;
  result: RegressionDto;
  fromScreens: AuditScreenDto[];
  toScreens: AuditScreenDto[];
  onClose: () => void;
}) {
  const remaining = remainingKinds.flatMap(([key, label]) =>
    result[key].map((change) => ({ change, label })),
  );
  const ratio =
    result.comparisonStatus === "empty"
      ? "비교할 항목 없음"
      : result.resolvedRatio === null
        ? "산출 보류"
        : `${Math.round(result.resolvedRatio * 100)}%${
            result.pending.length ? ` (보류 ${result.pending.length}건 제외)` : ""
          }`;
  const changed = result.screenChanges.filter((change) => change.status !== "clear");
  const pair = `${runLabel(audit, from)} → ${runLabel(audit, to)}`;
  return (
    <ReportDialog
      documentTitle={`DarkAudit 전후 비교 보고서 - ${displayName(audit.name)}`}
      onClose={onClose}
    >
      <article className="audit-report-document">
        <header className="audit-report-cover">
          <div className="audit-report-masthead">
            <img alt="DarkAudit" className="audit-report-logo" src={brandLogo({ dark: true })} />
            <span>금융상품 UX 진단</span>
          </div>
          <h1>전후 비교 보고서</h1>
          <h2 className="audit-report-project-name">{displayName(audit.name)}</h2>
          <dl className="audit-report-metadata">
            <div>
              <dt>진단 ID</dt>
              <dd>{audit.id}</dd>
            </div>
            <div>
              <dt>비교 회차</dt>
              <dd>{pair}</dd>
            </div>
            <div>
              <dt>비교 상태</dt>
              <dd>
                {
                  { complete: "완료", incomplete: "일부 판정 보류", empty: "비교할 항목 없음" }[
                    result.comparisonStatus
                  ]
                }
              </dd>
            </div>
            <div>
              <dt>출력 시각</dt>
              <dd>{new Date().toLocaleString("ko-KR")}</dd>
            </div>
          </dl>
        </header>
        <section className="audit-report-summary">
          <h2>01. 비교 요약</h2>
          <dl className="audit-report-totals">
            <div>
              <dt>원본 탐지</dt>
              <dd>
                {from.findingCount}
                <span>건</span>
              </dd>
            </div>
            <div>
              <dt>수정본 탐지</dt>
              <dd>
                {to.findingCount}
                <span>건</span>
              </dd>
            </div>
            <div>
              <dt>해결</dt>
              <dd>
                {result.resolved.length}
                <span>건</span>
              </dd>
            </div>
            <div>
              <dt>원본 항목 해결률</dt>
              <dd>{ratio}</dd>
            </div>
          </dl>
          <p>
            해결률은 원본 항목 중 같은 기준으로 다시 검사했을 때 잡히지 않은 비율입니다. 신규·재발과
            판정 보류 항목은 분모에 넣지 않습니다.
          </p>
        </section>
        <section className="audit-report-scope">
          <h2>02. 비교 범위와 한계</h2>
          {result.scopeDescription && <p>{result.scopeDescription}</p>}
          {result.limitations.length ? (
            <ul>
              {result.limitations.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p>두 회차 모두 같은 화면·규칙으로 검사를 마쳐 비교 제한이 없습니다.</p>
          )}
        </section>
        <section className="audit-report-unassigned" aria-label="해결 항목">
          <h2>03. 해결 항목 {result.resolved.length}건</h2>
          <p>원본 위치에서 문제가 사라진 항목입니다.</p>
          {result.resolved.length ? (
            result.resolved.map((change, index) => (
              <ChangeEntry
                key={`${change.findingId}-${index}`}
                change={change}
                label="해결"
                number={index + 1}
              />
            ))
          ) : (
            <p>해결로 확인된 원본 항목이 없습니다.</p>
          )}
        </section>
        <section className="audit-report-unassigned" aria-label="남은 항목">
          <h2>04. 남은 항목 {remaining.length}건</h2>
          <p>수정본에서 새로 탐지됐거나 유지·재발했거나 판정이 보류된 항목입니다.</p>
          {remaining.length ? (
            remaining.map(({ change, label }, index) => (
              <ChangeEntry
                key={`${label}-${change.findingId}-${index}`}
                change={change}
                label={label}
                number={index + 1}
              />
            ))
          ) : (
            <p>수정본에 남은 항목이 없습니다.</p>
          )}
        </section>
        {changed.map((change) => {
          const before = fromScreens.find((screen) => screen.id === change.screenId);
          const after = toScreens.find((screen) => screen.id === change.screenId);
          const step = change.flowStep ?? after?.flowStep ?? before?.flowStep ?? change.screenId;
          return (
            <section
              className="audit-report-screen"
              key={change.screenId}
              aria-label={`화면 ${screenNumber(change.screenId)} ${step} 변화`}
            >
              <div className="audit-report-screen-heading">
                <p className="audit-report-brand">05. 화면별 변화</p>
                <h2>
                  {screenNumber(change.screenId)}. {step}
                </h2>
                <p>{screenChangeLabel(change)}</p>
              </div>
              <div className="audit-report-columns">
                <figure>
                  <figcaption>
                    {runLabel(audit, from)} · {change.beforeCount}건
                  </figcaption>
                  {before ? (
                    <img src={before.imageUrl} alt={`${runLabel(audit, from)} ${step}`} />
                  ) : null}
                </figure>
                <figure>
                  <figcaption>
                    {runLabel(audit, to)} · {change.afterCount}건
                  </figcaption>
                  {after ? (
                    <img src={after.imageUrl} alt={`${runLabel(audit, to)} ${step}`} />
                  ) : null}
                </figure>
              </div>
            </section>
          );
        })}
      </article>
    </ReportDialog>
  );
}
