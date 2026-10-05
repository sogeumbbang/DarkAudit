import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const [source, title] of [
  ["스크린샷", "모루 펫케어"],
  ["URL", "로밍 패스"],
  ["Figma", "릿 크레딧"],
  ["APK", "모아 소액투자"],
]) {
  test(`${source} demo follows original, revised and comparison without variant choices`, async ({
    page,
  }, testInfo) => {
    await page.goto("/app/audits/new");
    const demos = page.getByRole("region", { name: "데모 체험" });
    await expect(demos.getByRole("combobox")).toHaveCount(0);
    if (source === "URL")
      await page.screenshot({ path: testInfo.outputPath("start.png"), fullPage: true });
    await demos.getByRole("button", { name: `${source} 데모 실행`, exact: true }).click();
    await expect(page.getByRole("heading", { name: "진단이 완료되었습니다" })).toBeVisible();
    await expect(page.getByRole("link", { name: "원본 결과 확인하기", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "비교하기", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "원본 결과 확인하기", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: `${source} 데모 · ${title} · 문제 포함 원본`,
        exact: true,
      }),
    ).toBeVisible();
    const auditId = new URL(page.url()).searchParams.get("audit");
    await expect(page.getByRole("link", { name: "전후 비교", exact: true })).toHaveCount(0);
    if (source === "URL") {
      await page.screenshot({ path: testInfo.outputPath("original.png"), fullPage: true });
      const result = await new AxeBuilder({ page }).analyze();
      expect(
        result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
      ).toEqual([]);
    }
    await page.getByRole("link", { name: "수정본 실행해보기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/audits/${auditId}/recheck$`));
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "내 파일로 재검사" })).toHaveCount(0);
    if (source === "URL")
      await page.screenshot({ path: testInfo.outputPath("revised-start.png"), fullPage: true });
    await page.getByRole("button", { name: "수정본 실행해보기", exact: true }).click();
    await expect(page.getByRole("heading", { name: "수정본 분석이 완료되었습니다" })).toBeVisible();
    await expect(page.getByRole("button", { name: "수정본 실행해보기", exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({ path: testInfo.outputPath(`${source}-completed.png`), fullPage: true });
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
    ).toEqual([]);
    await page.getByRole("link", { name: "비교하기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/benchmark\\?audit=${auditId}$`));
    await expect(page.getByRole("heading", { name: "v1 → v2 비교", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "수정본 재검사", exact: true })).toHaveCount(0);
    if (source === "URL")
      await page.screenshot({ path: testInfo.outputPath("comparison.png"), fullPage: true });
    await page.getByRole("link", { name: "진단 결과 보기", exact: true }).click();
    await expect(page.getByRole("link", { name: "비교하기", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "수정본 실행해보기", exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("audit")).toBe(auditId);
  });
}

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
