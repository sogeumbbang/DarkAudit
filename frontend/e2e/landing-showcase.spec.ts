import { expect, test } from "@playwright/test";

test("landing navigation and floating arrow return to the page top", async ({ page }) => {
  await page.goto("/landing");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("header").getByRole("link", { name: "진단 시작하기" })).toHaveCount(0);
  const backToTop = page.getByRole("button", { name: "페이지 맨 위로" });
  await expect(backToTop).toHaveCount(0);

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.locator(".lp-closing").scrollIntoViewIfNeeded();
    await expect(backToTop).toBeInViewport();
    await backToTop.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator("h1")).toBeFocused();
    await expect(backToTop).toHaveCount(0);
  }

  const menu = page.getByRole("button", { name: "랜딩 메뉴 열기" });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole("navigation", { name: "랜딩 메뉴" })).toBeVisible();
});

test("feature tabs change the preview and support keyboard navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/landing");
  const tabs = page.getByRole("tablist", { name: "DarkAudit 기능 둘러보기" });
  const first = tabs.getByRole("tab", { name: "화면 검토", exact: true });
  await first.focus();
  await first.press("End");
  const report = tabs.getByRole("tab", { name: "기록 · 보고서", exact: true });
  await expect(report).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "기록 · 보고서" })).toBeVisible();
  await report.press("ArrowRight");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.press("ArrowLeft");
  await expect(report).toBeFocused();
  await report.press("Home");
  await expect(first).toBeFocused();

  for (const [label, title] of [
    ["화면 검토", /놓치기 쉬운 곳을/],
    ["탐지 결과", /무엇을 발견했는지,/],
    ["검토 기준", /수정이 필요한 이유를/],
    ["개선 권고", /발견한 문제,/],
    ["기록 · 보고서", /검토한 내용을/],
  ] as const) {
    await tabs.getByRole("tab", { name: label, exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: label, exact: true });
    await expect(panel.getByRole("heading", { name: title })).toBeVisible();
    if (label === "검토 기준") {
      await expect(panel.getByRole("link", { name: "검토 기준 살펴보기" })).toHaveAttribute(
        "href",
        "/app/guidelines",
      );
    } else {
      await expect(panel.getByRole("link")).toHaveCount(0);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const image of document.images) image.loading = "eager";
      await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.screenshot({ path: testInfo.outputPath(`${label}.png`), animations: "disabled" });
  }
});
