import { expect, test } from "@playwright/test";

test("adapts content to phone, tablet and desktop widths", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, route, ready] of [
      ["dashboard", "/app/dashboard", "전체 진단"],
      ["review", "/app/overview?finding=finding-preselected-option", "보험 가입 흐름 v1"],
      ["create", "/app/audits/new", "AI UX 진단 시작"],
      ["records", "/app/audits", "보험 가입 흐름 v1"],
      ["guidelines", "/app/guidelines", "금융 다크패턴 4개 범주"],
    ]) {
      await page.goto(route!);
      await expect(page.getByText(ready!, { exact: true }).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (name === "dashboard") {
        await expect(page.getByRole("region", { name: "진단 목록 표" })).toBeVisible({
          visible: width === 1440,
        });
        await expect(page.getByRole("list", { name: "진단 목록", exact: true })).toBeVisible({
          visible: width !== 1440,
        });
      }
      if (name === "review") {
        const preview = await page.locator(".map-preview").boundingBox();
        const findings = await page.locator(".review-findings").boundingBox();
        expect(preview).not.toBeNull();
        expect(findings).not.toBeNull();
        if (width < 1440) expect(findings!.y).toBeGreaterThanOrEqual(preview!.y + preview!.height);
        else expect(Math.abs(findings!.y - preview!.y)).toBeLessThan(2);
      }
      if (name === "create" && width <= 390) {
        const input = page.getByLabel("진단 이름");
        expect(
          await input.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        ).toBeGreaterThanOrEqual(16);
      }
      if ([390, 1024, 1440].includes(width) && ["review", "dashboard", "create"].includes(name!)) {
        await page.screenshot({
          path: testInfo.outputPath(`${name}-${width}.png`),
          fullPage: true,
        });
      }
    }
  }
});

test("mobile navigation traps focus, closes and restores scrolling across a resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/app/dashboard");
  const opener = page.getByRole("button", { name: "메뉴 열기" });
  const menu = page.getByRole("dialog", { name: "주요 메뉴" });
  await opener.click();
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    expect(await menu.evaluate((e) => e.contains(document.activeElement))).toBe(true);
  }
  await menu.getByRole("button", { name: "메뉴 닫기" }).last().click();
  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await opener.click();
  await menu.getByRole("link", { name: "진단 기록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "진단 기록", exact: true })).toBeVisible();
  await expect(menu).toHaveCount(0);
  await opener.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("chat input and close controls fit a narrow, short mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 440 });
  await page.goto("/app/dashboard");
  await page.getByRole("button", { name: "다크패턴 챗봇", exact: true }).click();
  const chat = page.getByRole("region", { name: "다크패턴 챗봇", exact: true });
  for (const control of [
    chat,
    page.getByRole("textbox", { name: "질문", exact: true }),
    page.getByRole("button", { name: "보내기", exact: true }),
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.y + box!.height).toBeLessThanOrEqual(440);
  }
  await page.getByRole("textbox", { name: "질문", exact: true }).fill("사전선택 기준이 궁금합니다");
  await page.getByRole("button", { name: "챗봇 닫기", exact: true }).click();
  await expect(chat).toHaveCount(0);
});

test("a swipe over the fitted preview scrolls the mobile page", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Requires the touch device project");
  await page.goto("/app/overview?finding=finding-preselected-option");
  const preview = page.getByTestId("screen-preview-viewport");
  await preview.scrollIntoViewIfNeeded();
  const box = await preview.boundingBox();
  const before = await page.evaluate(() => scrollY);
  const session = await page.context().newCDPSession(page);
  const x = Math.round(box!.x + box!.width / 2);
  const y = Math.round(box!.y + box!.height / 2);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - step * 20 }],
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 50);
  await page.getByRole("button", { name: "확대", exact: true }).click();
  await expect(preview).toHaveCSS("touch-action", "none");
  await page.getByRole("button", { name: "화면 전체 보기", exact: true }).click();
  await expect(preview).toHaveCSS("touch-action", "pan-y pinch-zoom");
  await session.detach();
});
