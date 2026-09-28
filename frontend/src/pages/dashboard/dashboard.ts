import type { AuditDto } from "@/entities/audit/types";

export const productLabels = {
  insurance: "보험",
  deposit: "예금·적금",
  loan: "대출",
  investment: "투자",
  other: "기타",
};

export function reviewStatus(audit: AuditDto) {
  if (audit.status !== "completed") {
    return { draft: "준비 중", queued: "대기 중", analyzing: "분석 중", failed: "분석 실패" }[
      audit.status
    ];
  }
  if (audit.analysisSummary?.complete === false) return "추가 확인 필요";
  return audit.findings.some((finding) => finding.status !== "resolved")
    ? "검토 필요"
    : "검토 완료";
}

export function dashboardMetrics(audits: AuditDto[]) {
  return {
    total: audits.length,
    needsReview: audits.filter((audit) =>
      ["검토 필요", "추가 확인 필요"].includes(reviewStatus(audit)),
    ).length,
    reviewed: audits.filter((audit) => reviewStatus(audit) === "검토 완료").length,
    candidates: audits.reduce((total, audit) => total + audit.findings.length, 0),
  };
}
