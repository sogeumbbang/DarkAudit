import { expect, test } from "@playwright/test";

test("exports only the selected audit with a printable A4 report", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/app/overview");
  await page.getByRole("button", { name: "PDF 보고서 출력" }).click();
  const report = page.getByRole("dialog", { name: "PDF 보고서 미리보기" });
  await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { name: "보험 가입 흐름 v1" })).toBeVisible();
  await expect(report.locator(".audit-report-finding")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("report-preview.png") });

  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = document.title;
    };
  });
  await report.getByRole("button", { name: "인쇄 / PDF 저장" }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-printed",
    "DarkAudit 보고서 - 보험 가입 흐름 v1",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#root")).toBeHidden();
  await expect(report.locator(".audit-report-toolbar")).toBeHidden();
  await expect(report.locator("article")).toBeVisible();
  if (!isMobile) {
    await page.pdf({ path: testInfo.outputPath("report.pdf"), preferCSSPageSize: true });
  }
  await page.screenshot({ path: testInfo.outputPath("report-print.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await report.getByRole("button", { name: "닫기" }).click();
  await expect(report).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF 보고서 출력" })).toBeFocused();

  await page.getByRole("link", { name: "진단 관리" }).click();
  await page.getByRole("link", { name: "적금 가입 흐름 v2", exact: true }).click();
  await page.getByRole("button", { name: "PDF 보고서 출력" }).click();
  await expect(report.getByRole("heading", { name: "적금 가입 흐름 v2" })).toBeVisible();
  await expect(report.locator(".audit-report-finding")).toHaveCount(0);
  await expect(report.getByText(/탐지된 항목이 없습니다/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(report).toHaveCount(0);
});
