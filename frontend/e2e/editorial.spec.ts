import { expect, test } from "@playwright/test";

// Capture the complete product at both configured viewport sizes and guard
// against accidental page overflow as editorial layouts collapse on mobile.
test("editorial layouts fit the viewport across the product", async ({ page }, testInfo) => {
  for (const [name, route, heading] of [
    ["landing", "/landing", /다 만든 화면,/],
    ["dashboard", "/app/dashboard", "대시보드"],
    ["review", "/app/overview?finding=finding-preselected-option", "보험 가입 흐름 v1"],
    ["create", "/app/audits/new", "AI UX 진단 시작"],
    ["records", "/app/audits", "진단 기록"],
    ["guidelines", "/app/guidelines", "금융 다크패턴 4개 범주"],
  ] as const) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    if (name === "dashboard")
      await expect(page.getByRole("link", { name: "이어서 검토하기", exact: true })).toBeVisible();
    if (name === "records")
      await expect(
        page.getByRole("link", { name: "보험 가입 흐름 v1", exact: true }),
      ).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const image of document.images) image.loading = "eager";
      await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("continue reviewing opens the indicated finding and separates its evidence", async ({
  page,
}) => {
  await page.goto("/app/dashboard");
  await page.getByRole("link", { name: "이어서 검토하기", exact: true }).click();
  await expect(page).toHaveURL(/finding=/);
  const finding = page.locator("#finding-detail-panel");
  for (const label of [
    "WHERE · 대상 요소",
    "OBSERVATION · 관찰 내용",
    "RULE · 검토 기준",
    "WHY · 검토가 필요한 이유",
    "FIX · 개선 방향",
  ]) {
    await expect(finding.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("WHAT · 발견한 문제", { exact: true })).toBeVisible();
  await expect(finding.getByRole("link", { name: "DA-04", exact: true })).toHaveAttribute(
    "href",
    "/app/guidelines",
  );
});

test("review and creation remain usable on tablet and narrow screens", async ({ page }) => {
  for (const width of [320, 820, 1024]) {
    await page.setViewportSize({ width, height: 1180 });
    for (const [route, heading] of [
      ["/landing", /다 만든 화면,/],
      ["/app/dashboard", "대시보드"],
      ["/app/overview?finding=finding-preselected-option", "보험 가입 흐름 v1"],
      ["/app/audits/new", "AI UX 진단 시작"],
    ] as const) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      if (route === "/app/dashboard")
        await expect(
          page.getByRole("link", { name: "이어서 검토하기", exact: true }),
        ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (route === "/landing") {
        // A clipped parent can hide an oversized grid without page overflow.
        for (const selector of [
          ".lp-intro-copy",
          ".lp-intro-description",
          ".lp-intro-copy > .lp-primary-action",
          ".lp-intro h1",
        ]) {
          const bounds = await page.locator(selector).boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
      }
      if (route.startsWith("/app/overview")) {
        await page.getByRole("link", { name: "화면에서 위치 확인" }).click();
        await expect(page.getByTestId("screen-preview-viewport")).toBeInViewport();
        await expect(page.locator("#finding-detail-panel")).toBeAttached();
      }
    }
  }
});
