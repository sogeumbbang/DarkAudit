import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dashboardFixture } from "../src/mocks/fixtures/dashboard";

test("shows review candidates and deferred verification before findings and in the report", async ({
  page,
}, testInfo) => {
  await page.goto("/app/overview");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();
  const fixture = structuredClone(dashboardFixture);
  fixture.audits[0]!.analysisSummary = {
    complete: false,
    reviewRequired: true,
    supportedRules: ["DA-03", "DA-04", "DA-07", "DA-12", "DA-15"],
    unsupportedRules: [
      "DA-01",
      "DA-02",
      "DA-05",
      "DA-06",
      "DA-08",
      "DA-09",
      "DA-10",
      "DA-11",
      "DA-13",
      "DA-14",
    ],
    analyzedScreenCount: 5,
    limitations: ["일부 화면의 근거를 확인하지 못했습니다."],
    ruleAssessments: [
      { ruleId: "DA-07", status: "insufficient_evidence", reasons: ["중요 정보 확인 필요"] },
    ],
    regression: {
      comparisonStatus: "incomplete",
      pendingCount: 1,
      resolvedRatio: null,
      limitations: ["두 회차의 화면 구성이 달라 해결 여부를 확인할 수 없습니다."],
    },
  };
  // Inject a server-result fixture into the dev app's cache without making external requests.
  await page.evaluate(async (data) => {
    const modulePath = "/src/app/query-client.ts";
    const { queryClient } = await import(modulePath);
    queryClient.setQueryData(["dashboard", "summary"], data);
  }, fixture);
  const notice = page.getByRole("region", { name: "분석 범위" });
  await expect(notice.getByText(/검토 후보 · 이미지 중심/)).toBeVisible();
  await expect(notice.getByText(/DA-07: 근거 부족/)).toBeVisible();
  await expect(notice.getByText(/미지원 규칙 10개/)).toBeVisible();
  await expect(notice.getByText(/재검증 판정 보류/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("analysis-notice.png"), fullPage: true });
  await page.getByRole("button", { name: "PDF 보고서 출력" }).click();
  const report = page.getByRole("dialog", { name: "PDF 보고서 미리보기" });
  await expect(report.getByText(/검토 후보 · 이미지 중심/)).toBeVisible();
  await expect(report.getByText(/재검증 판정 보류/)).toBeVisible();
});
