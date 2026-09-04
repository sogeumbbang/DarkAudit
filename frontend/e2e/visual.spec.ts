import { expect, type Page, test } from "@playwright/test";

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      let previousHeight = -1;
      let stableFrames = 0;

      function measure() {
        const height = document.documentElement.scrollHeight;
        stableFrames = height === previousHeight ? stableFrames + 1 : 0;
        previousHeight = height;
        if (stableFrames >= 3) resolve();
        else requestAnimationFrame(measure);
      }

      requestAnimationFrame(measure);
    });
  });
}

test("landing visual", async ({ page }) => {
  await page.goto("/landing");
  await page.getByRole("heading", { name: /금융상품 UX를/ }).waitFor();
  await waitForStableLayout(page);
  await expect(page).toHaveScreenshot("landing.png", { fullPage: true, animations: "disabled" });
});

test("overview visual", async ({ page }) => {
  await page.goto("/app/overview");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();
  await waitForStableLayout(page);
  await expect(page).toHaveScreenshot("overview.png", { fullPage: true, animations: "disabled" });
});
