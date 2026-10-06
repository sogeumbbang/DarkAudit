import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("uploads replacements to the same audit and opens the latest comparison", async ({
  page,
}, testInfo) => {
  await page.goto("/app/overview?audit=audit-insurance-v1");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();
  await page.evaluate(async () => {
    const fixturePath = "/src/mocks/fixtures/dashboard.ts";
    const queryPath = "/src/app/query-client.ts";
    const { dashboardFixture } = await import(fixturePath);
    const { queryClient } = await import(queryPath);
    dashboardFixture.audits[0].status = "completed";
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  });
  await page.getByRole("link", { name: "수정본 검사하기", exact: true }).click();
  await expect(page).toHaveURL(/\/audits\/audit-insurance-v1\/recheck$/);
  await expect(page.getByRole("heading", { name: "수정본 검사", exact: true })).toBeVisible();
  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(5);
  await expect(page.getByRole("button", { name: "수정본 검사 시작" })).toBeDisabled();
  for (let index = 0; index < (await inputs.count()); index++) {
    await inputs.nth(index).setInputFiles({
      name: `replacement-${index}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  }
  await page.screenshot({ path: testInfo.outputPath("recheck-upload.png"), fullPage: true });
  const uploadAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    uploadAccessibility.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "수정본 검사 시작" }).click();
  await expect(page.getByRole("heading", { name: "수정본 검사가 완료되었습니다" })).toBeVisible();
  await page.getByRole("link", { name: "전후 비교 보기" }).click();
  await expect(page.getByRole("heading", { name: "v1 원본 → v2 수정본 비교" })).toBeVisible();
  await expect(page.getByText("산출 보류")).toBeVisible();
  await expect(
    page.getByText("모의 분석 결과이므로 실제 해결 여부를 확인할 수 없습니다."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "남은 항목 3건" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const comparisonAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    comparisonAccessibility.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("comparison.png"), fullPage: true });
});

test("starts reviewing an open finding and keeps the state after navigation", async ({ page }) => {
  await page.goto(
    "/app/overview?audit=audit-insurance-v1&finding=finding-emotional-pressure&panel=1",
  );
  await page.getByRole("button", { name: "검토 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "검토 시작", exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "점검 항목" })
      .getByRole("button", { name: /감정적 압박 검토 중/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "진단 관리", exact: true }).click();
  await page.getByRole("link", { name: "보험 가입 흐름 v1", exact: true }).click();
  await page
    .getByRole("navigation", { name: "점검 항목" })
    .getByRole("button", { name: /감정적 압박/ })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "점검 항목" })
      .getByRole("button", { name: /감정적 압박 검토 중/ }),
  ).toBeVisible();
});
