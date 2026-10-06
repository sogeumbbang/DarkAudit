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
      page.getByRole("heading", { name: `${source} 데모 · ${title}`, exact: true }),
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
    const noOverflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    // ① Revision run
    await page.getByRole("link", { name: "수정본 검사하기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/audits/${auditId}/recheck$`));
    await expect(page.getByRole("heading", { name: "수정본 검사", exact: true })).toBeVisible();
    const steps = page.getByRole("navigation", { name: "수정본 검사 단계" });
    await expect(steps.getByRole("link", { name: /원본 검사/ })).toBeVisible();
    await expect(steps.getByText("수정본 검사 후 열림")).toBeVisible();
    await expect(page.getByText(/고칠 대상 · 원본 v1/)).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    expect(await noOverflow()).toBe(true);
    if (source === "URL")
      await page.screenshot({ path: testInfo.outputPath("revised-start.png"), fullPage: true });
    await page.getByRole("button", { name: "수정본 검사 시작", exact: true }).click();
    await expect(page.getByRole("heading", { name: "수정본 검사가 완료되었습니다" })).toBeVisible();
    await expect(page.getByRole("button", { name: "수정본 검사 시작", exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({ path: testInfo.outputPath(`${source}-completed.png`), fullPage: true });
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
    ).toEqual([]);

    // ② Revision result against the original
    await page.getByRole("link", { name: "수정본 결과 보기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`version=2`));
    await expect(page.locator(".rc-badge", { hasText: "v2 수정본" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "회차 전환" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "원본 대비 결과" })).toBeVisible();
    const panel = page.getByRole("complementary", { name: "원본 대비 변화" });
    await expect(panel).toBeVisible();
    if (source === "스크린샷") {
      await expect(page.getByRole("region", { name: "원본 대비 결과" })).toContainText("7 → 1");
      const flow = page.getByRole("group", { name: "가입 흐름 단계" });
      await expect(flow.getByText("3 → 0 · 해결")).toBeVisible();
      await expect(flow.getByText("0 → 1 · 신규")).toBeVisible();
      await expect(page.getByText("v1 원본 · 3건")).toBeVisible();
      await expect(page.getByText("v2 수정본 · 해결 3")).toBeVisible();
      await expect(panel.getByRole("heading", { name: "해결 7건" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("revision-result.png"), fullPage: true });
    }
    expect(await noOverflow()).toBe(true);

    // ③ Comparison
    await panel.getByRole("link", { name: "전후 비교에서 자세히 보기" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/benchmark\\?audit=${auditId}$`));
    await expect(page.getByRole("heading", { name: "v1 원본 → v2 수정본 비교" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "비교 기준" })).toHaveValue("1");
    await expect(page.getByRole("combobox", { name: "비교 대상" })).toHaveValue("2");
    await expect(page.getByRole("region", { name: "비교 요약" })).toBeVisible();
    await expect(page.getByRole("button", { name: "PDF 보고서 출력" })).toBeVisible();
    // The revision step now opens its result; a new run has its own button.
    await expect(
      page
        .getByRole("navigation", { name: "수정본 검사 단계" })
        .getByRole("link", { name: /수정본 검사/ }),
    ).toHaveAttribute("href", new RegExp(`version=2$`));
    if (source === "스크린샷") {
      await expect(page.getByRole("region", { name: "비교 요약" })).toContainText("7 → 1건");
      await expect(page.getByRole("region", { name: "비교 요약" })).toContainText("100%");
      await expect(page.getByRole("heading", { name: "해결 7건" })).toBeVisible();
      await expect(page.getByText("유지 0건")).toBeVisible();
    }
    expect(await noOverflow()).toBe(true);
    if (source === "URL" || source === "스크린샷")
      await page.screenshot({ path: testInfo.outputPath("comparison.png"), fullPage: true });
    await page
      .getByRole("navigation", { name: "수정본 검사 단계" })
      .getByRole("link", { name: /원본 검사/ })
      .click();
    await expect(page.locator(".rc-badge", { hasText: "v1 원본" })).toBeVisible();
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
