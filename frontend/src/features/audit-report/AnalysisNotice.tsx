import type { AnalysisSummary } from "@/entities/audit/types";

const statuses = {
  detected: "탐지됨",
  not_detected: "관찰 범위 내 미탐지",
  insufficient_evidence: "근거 부족",
  not_supported: "미지원",
};

export function AnalysisNotice({ summary }: { summary?: AnalysisSummary }) {
  const incomplete = summary?.complete !== true;
  const assessments = summary?.ruleAssessments ?? [];
  const needsAttention = assessments.filter(
    (item) => item.status === "insufficient_evidence" || item.status === "not_supported",
  );
  const inspected = assessments.filter((item) => !needsAttention.includes(item));

  return (
    <section
      aria-label="분석 범위"
      className="analysis-notice rounded border border-border p-4 text-sm"
    >
      {summary?.reviewRequired && (
        <p className="mb-2 font-semibold">
          검토 후보 · 이미지 중심 분석 결과입니다. 표시된 근거를 확인한 뒤 판단해 주세요.
        </p>
      )}
      <h2 className="font-semibold">
        {incomplete ? "검사 범위와 추가 확인 사항" : "수집한 화면의 지원 규칙 검사 완료"}
      </h2>
      {incomplete && <p>분석 완료 여부를 확인하거나 추가 검토가 필요합니다.</p>}
      <p>탐지 0건이 전체 화면과 규칙에 문제가 없다는 뜻은 아닙니다.</p>
      {summary?.supportedRules && (
        <p>
          지원 규칙 {summary.supportedRules.length}개 · 분석 화면 {summary.analyzedScreenCount ?? 0}
          개
        </p>
      )}
      {!!summary?.limitations?.length && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {summary.limitations.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      )}
      {needsAttention.map((item) => (
        <p key={item.ruleId} className="mt-1">
          {item.ruleId}: {statuses[item.status]}
          {item.reasons.length > 0 && ` — ${item.reasons.join(" / ")}`}
        </p>
      ))}
      {!!summary?.unsupportedRules?.length && (
        <p className="mt-2">
          미지원 규칙 {summary.unsupportedRules.length}개: {summary.unsupportedRules.join(", ")}
        </p>
      )}
      {summary?.regression?.comparisonStatus === "incomplete" && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="font-semibold">
            {summary.regression.resolvedRatio === null
              ? "재검증 판정 보류 · 해결률을 계산하지 않았습니다."
              : "일부 재검증 판정 보류 · 해결률은 보류 항목을 제외하고 계산했습니다."}
          </p>
          <p>해결 여부를 확인하지 못한 기존 항목: {summary.regression.pendingCount}건</p>
          <ul className="list-disc pl-5">
            {summary.regression.limitations.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {inspected.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer">규칙별 검사 결과</summary>
          {inspected.map((item) => (
            <p key={item.ruleId}>
              {item.ruleId}: {statuses[item.status]}
              {item.reasons.length > 0 && ` — ${item.reasons.join(" / ")}`}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
