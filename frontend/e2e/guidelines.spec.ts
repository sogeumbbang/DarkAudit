import { expect, test } from "@playwright/test";

test("guidelines show one category and one expanded explanation at a time", async ({
  page,
}, testInfo) => {
  await page.goto("/app/guidelines");
  const navigation = page.getByRole("navigation", { name: "가이드라인 범주" });
  const content = page.locator("#guideline-category-content");
  await expect(content.getByRole("button", { expanded: true })).toHaveCount(1);
  await expect(content.getByRole("button")).toHaveCount(5);
  await content.getByRole("button", { name: /속임수 질문/ }).click();
  await expect(content.getByRole("button", { name: /설명절차의 과도한 축약/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(content.getByRole("region", { name: /속임수 질문/ })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 450));
  await expect(navigation.getByRole("button", { name: /압박형/ })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("guidelines-sticky.png") });
  await navigation.getByRole("button", { name: /압박형/ }).click();
  await expect(content.getByRole("heading", { name: "압박형", exact: true })).toBeInViewport();
  await expect(content.getByRole("button", { expanded: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("guidelines-layout.png"), fullPage: true });

  for (const [name, count] of [
    ["방해형", 4],
    ["압박형", 5],
    ["편취유도형", 1],
  ] as const) {
    const button = navigation.getByRole("button", { name: new RegExp(name) });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(content.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(content.getByRole("button")).toHaveCount(count);
    await expect(content.getByRole("button", { expanded: true })).toHaveCount(1);
  }
  const lastItem = content.getByRole("button", { name: /순차공개 가격책정/ });
  await lastItem.focus();
  await page.keyboard.press("Enter");
  await expect(lastItem).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(lastItem).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: /공식 게시글/ })).toHaveAttribute(
    "href",
    "https://www.fsc.go.kr/po010101/85942",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
