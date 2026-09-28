import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { dashboardMetrics, reviewStatus } from "./dashboard";

it("counts audits separately from risk candidates and excludes incomplete analysis from reviewed", () => {
  const base = dashboardFixture.audits[0]!;
  const pending = { ...base, status: "completed" as const };
  const reviewed = {
    ...pending,
    findings: pending.findings.map((finding) => ({ ...finding, status: "resolved" as const })),
  };
  const incomplete = { ...reviewed, analysisSummary: { complete: false } };
  expect(dashboardMetrics([pending, reviewed, incomplete, { ...base, status: "failed" }])).toEqual({
    total: 4,
    needsReview: 2,
    reviewed: 1,
    candidates: 12,
  });
  expect(reviewStatus({ ...pending, findings: [] })).toBe("검토 완료");
  expect(dashboardMetrics([])).toEqual({ total: 0, needsReview: 0, reviewed: 0, candidates: 0 });
});
