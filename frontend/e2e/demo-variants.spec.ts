import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("runs original, partial and revised demos in the same audit", async ({ page }, testInfo) => {
  await page.goto("/app/audits/new");
  await expect(page.getByLabel("실행할 데모 버전")).toBeVisible();
  await page.getByLabel("스크린샷·URL 데모 시나리오").selectOption("pet");
  await page.getByRole("button", { name: "스크린샷 데모 실행", exact: true }).click();
  await expect(page.getByRole("heading", { name: "진단이 완료되었습니다" })).toBeVisible();
  await page.getByRole("link", { name: "데모 수정본 실행", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audits\/[^/]+\/recheck$/);
  const originalAuditUrl = page.url();
  await expect(page.getByLabel("실행할 수정본")).toHaveValue("partial");
  await page.getByRole("button", { name: "선택한 데모 수정본 실행" }).click();
  await expect(
    page.getByRole("heading", { name: "데모 수정본 분석이 완료되었습니다" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "전체 개선본 선택" }).click();
  await expect(page.getByLabel("실행할 수정본")).toHaveValue("revised");
  await page.getByRole("button", { name: "선택한 데모 수정본 실행" }).click();
  await expect(
    page.getByRole("heading", { name: "데모 수정본 분석이 완료되었습니다" }),
  ).toBeVisible();
  expect(page.url()).toBe(originalAuditUrl);
  await page.screenshot({ path: testInfo.outputPath("demo-updates.png"), fullPage: true });
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
  ).toEqual([]);
  await page.getByRole("link", { name: "전후 비교 보기" }).click();
  await expect(page.getByRole("heading", { name: "v2 → v3 비교" })).toBeVisible();
  await expect(page.getByText("해결률 · 산출 보류")).toBeVisible();
  await page.getByRole("link", { name: "진단 결과 보기" }).click();
  await expect(page.getByRole("link", { name: "데모 수정본 실행" })).toBeVisible();
});

test("can start directly with a revised scenario", async ({ page }) => {
  await page.goto("/app/audits/new");
  await page.getByLabel("스크린샷·URL 데모 시나리오").selectOption("credit");
  await page.getByLabel("실행할 데모 버전").selectOption("revised");
  await page.getByRole("button", { name: "스크린샷 데모 실행", exact: true }).click();
  await expect(page.getByRole("heading", { name: "진단이 완료되었습니다" })).toBeVisible();
  await page.getByRole("link", { name: "결과 확인하기" }).click();
  await expect(
    page.getByRole("heading", { name: "스크린샷 데모 · 릿 크레딧 · 전체 개선본" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "데모 수정본 실행" }).click();
  await expect(page.getByText("최근 등록한 데모: 전체 개선본")).toBeVisible();
});

test("web variants keep option state isolated and improve the authored choices", async ({
  page,
}) => {
  for (const scenario of ["pet", "travel", "credit"]) {
    const base = `/dark-pattern-demo/index.html?scenario=${scenario}`;
    await page.goto(`${base}&variant=risky&step=2`);
    await expect(page.locator("[data-option]:checked")).toHaveCount(3);
    await page.locator("[data-option='0']").uncheck();
    await page.locator("[data-next]").first().click();
    await page.goto(`${base}&variant=partial&step=2`);
    await expect(page.locator("[data-option]:checked")).toHaveCount(0);
    await page.goto(`${base}&variant=revised&step=3`);
    const primary = await page.locator("[data-next]").first().boundingBox();
    const secondary = await page.locator("button.secondary").boundingBox();
    expect(primary!.height).toBe(secondary!.height);
    await page.goto(`${base}&variant=revised&step=4`);
    await expect(page.locator(".pressure")).toHaveCount(0);
    await expect(page.locator("button.secondary")).toHaveCount(0);
  }
});

for (const source of ["Figma", "APK", "URL"]) {
  test(`${source} demo preserves the audit across original, partial and revised runs`, async ({
    page,
  }, testInfo) => {
    await page.goto("/app/audits/new");
    await page.getByRole("button", { name: `${source} 데모 실행`, exact: true }).click();
    await expect(page.getByRole("heading", { name: "진단이 완료되었습니다" })).toBeVisible();
    await page.getByRole("link", { name: "데모 수정본 실행", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/audits\/[^/]+\/recheck$/);
    const originalAuditUrl = page.url();
    for (const variant of ["partial", "revised"]) {
      await page.getByLabel("실행할 수정본").selectOption(variant);
      await page.getByRole("button", { name: "선택한 데모 수정본 실행" }).click();
      await expect(
        page.getByRole("heading", { name: "데모 수정본 분석이 완료되었습니다" }),
      ).toBeVisible();
      expect(page.url()).toBe(originalAuditUrl);
    }
    await page.screenshot({ path: testInfo.outputPath(`${source}-recheck.png`), fullPage: true });
    await page.getByRole("link", { name: "전후 비교 보기" }).click();
    await expect(page.getByRole("heading", { name: "v2 → v3 비교" })).toBeVisible();
  });
}
