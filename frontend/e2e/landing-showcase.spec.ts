import { expect, test } from "@playwright/test";

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
    ["화면 검토", /놓치기 쉬운 곳에,/],
    ["탐지 결과", /무엇을 발견했는지,/],
    ["검토 기준", /수정의 이유에도,/],
    ["개선 권고", /발견한 문제를,/],
    ["기록 · 보고서", /화면의 발견을,/],
  ] as const) {
    await tabs.getByRole("tab", { name: label, exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: label, exact: true });
    await expect(panel.getByRole("heading", { name: title })).toBeVisible();
    await expect(panel.getByRole("link")).toHaveAttribute(
      "href",
      label === "검토 기준" ? "/app/guidelines" : "/app/audits/new",
    );
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
