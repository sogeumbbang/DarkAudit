import { expect, test } from "@playwright/test";

test("clips the report scrollbar and dismisses only deliberate backdrop clicks", async ({
  page,
}, testInfo) => {
  await page.goto("/app/overview");
  const trigger = page.getByRole("button", { name: "PDF 보고서 출력" });
  await trigger.click();
  const report = page.getByRole("dialog", { name: "PDF 보고서 미리보기" });
  const scroll = report.locator(".audit-report-scroll");
  await expect(report).toHaveCSS("overflow", "hidden");
  await expect(report).toHaveCSS("border-radius", "12px");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(
    report.getByRole("img", { name: "완료 분석 대상 화면", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("report-rounded-scroll.png") });
  const bounds = (await report.boundingBox())!;
  const inside = { x: bounds.x + 8, y: bounds.y + bounds.height / 2 };
  const outside = { x: bounds.x - 8, y: inside.y };
  await page.mouse.click(inside.x, inside.y);
  await expect(report).toBeVisible();
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.up();
  await expect(report).toBeVisible();
  await page.mouse.click(outside.x, outside.y);
  await expect(report).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("exports only the selected audit with a printable A4 report", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/app/overview");
  await page.getByRole("button", { name: "PDF 보고서 출력" }).click();
  const report = page.getByRole("dialog", { name: "PDF 보고서 미리보기" });
  await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { name: "보험 가입 흐름 v1" })).toBeVisible();
  await expect(report.locator(".audit-report-finding")).toHaveCount(4);
  const optionScreen = report.getByRole("region", { name: "화면 2. 옵션 선택" });
  await expect(optionScreen.locator(".audit-report-finding")).toHaveCount(2);
  const columns = optionScreen.locator(".audit-report-columns");
  const evidenceImage = optionScreen.getByRole("img", { name: "옵션 선택 분석 대상 화면" });
  await evidenceImage.evaluate((image) => (image as HTMLImageElement).decode());
  await expect(evidenceImage).toHaveCSS("filter", "none");
  await expect(optionScreen.getByLabel("1. 유료 옵션 사전 선택 탐지 영역")).toHaveText("1");
  await expect(optionScreen.getByLabel("3. 순차적 가격 공개 관련 영역")).toHaveText("3");
  async function checkEvidenceAlignment() {
    const image = (await evidenceImage.boundingBox())!;
    const box = (await optionScreen
      .locator(".audit-report-annotations rect")
      .first()
      .boundingBox())!;
    // SVG bounding boxes include the 2px stroke, extending 1px on each side.
    expect(Math.abs(box.x + 1 - image.x - (image.width * 24) / 390)).toBeLessThan(1);
    expect(Math.abs(box.y + 1 - image.y - (image.height * 520) / 844)).toBeLessThan(1);
    expect(Math.abs(box.width - 2 - (image.width * 342) / 390)).toBeLessThan(1);
    expect(Math.abs(box.height - 2 - (image.height * 48) / 844)).toBeLessThan(1);
  }
  await checkEvidenceAlignment();
  const previewImage = await columns.locator("figure").boundingBox();
  const previewContent = await columns.locator(".audit-report-screen-findings").boundingBox();
  expect(previewImage).not.toBeNull();
  expect(previewContent).not.toBeNull();
  if (isMobile) {
    expect(previewContent!.y).toBeGreaterThanOrEqual(previewImage!.y + previewImage!.height);
  } else {
    expect(previewContent!.x).toBeGreaterThan(previewImage!.x + previewImage!.width);
    expect(Math.abs(previewContent!.y - previewImage!.y)).toBeLessThan(1);
  }
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
  const printImage = await columns.locator("figure").boundingBox();
  const printContent = await columns.locator(".audit-report-screen-findings").boundingBox();
  expect(printImage).not.toBeNull();
  expect(printContent).not.toBeNull();
  expect(printContent!.x).toBeGreaterThan(printImage!.x + printImage!.width);
  expect(Math.abs(printContent!.y - printImage!.y)).toBeLessThan(1);
  await expect(optionScreen).toHaveCSS("break-before", "page");
  await checkEvidenceAlignment();
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
