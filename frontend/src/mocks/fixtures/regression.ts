import type { RegressionDto } from "@/entities/audit/types";

/** 수정본 재업로드 뒤 비교 결과 목업. DA-04·DA-15는 해결, DA-07은 유지, DA-12는 개선. */
export const regressionFixture: RegressionDto = {
  auditId: "audit-insurance-v1",
  fromVersion: 1,
  toVersion: 2,
  resolved: [
    { ruleId: "DA-04", findingId: "finding-1", before: "HIGH", after: null },
    { ruleId: "DA-15", findingId: "finding-3", before: "HIGH", after: null },
  ],
  improved: [{ ruleId: "DA-12", findingId: "finding-5", before: "HIGH", after: "REVIEW" }],
  persisted: [{ ruleId: "DA-07", findingId: "finding-4", before: "HIGH", after: "HIGH" }],
  new: [],
  regressed: [],
  resolvedRatio: 0.5,
};
