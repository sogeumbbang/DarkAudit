import { expect, type Page, test } from "@playwright/test";

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Full-page snapshots also need below-the-fold, lazily loaded photographs.
    for (const image of document.images) image.loading = "eager";
    // Loading can finish before async decoding/painting, especially with responsive
    // WebP images. Decode every selected source and fail on missing assets.
    await Promise.all(
      [...document.images].map(async (image) => {
        await image.decode();
        if (!image.naturalWidth) throw new Error(`Image did not load: ${image.currentSrc}`);
      }),
    );
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
  await page.getByRole("heading", { name: /다 만든 화면,/ }).waitFor();
  await waitForStableLayout(page);
  // 같은 Windows라도 기기마다 글꼴 안티앨리어싱이 몇 픽셀 갈린다(약 1,100만 픽셀 중 3개).
  // 레이아웃이 바뀌면 수천 픽셀이 달라지므로 이 폭은 허용한다.
  await expect(page).toHaveScreenshot("landing.png", {
    fullPage: true,
    animations: "disabled",
    maxDiffPixels: 100,
    // CI must have time for two full-page captures, including image encoding.
    timeout: 15_000,
  });
});

test("overview visual", async ({ page }) => {
  await page.goto("/app/overview");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();
  await waitForStableLayout(page);
  // Page height can settle before ResizeObserver updates the image overlay.
  // Require real image/overlay alignment instead of capturing the initial box.
  await expect
    .poll(() =>
      page.getByTestId("screen-preview-viewport").evaluate((viewport) => {
        const image = viewport.querySelector("img")?.getBoundingClientRect();
        const overlay = viewport.querySelector('[aria-label="탐지 위치"]')?.getBoundingClientRect();
        return Boolean(
          image &&
          overlay &&
          image.height > 0 &&
          (["x", "y", "width", "height"] as const).every(
            (key) => Math.abs(image[key] - overlay[key]) < 1,
          ),
        );
      }),
    )
    .toBe(true);
  // bbox 오버레이는 렌더링된 <img> 박스를 실측해 퍼센트로 얹는다. 축소된 미리보기에서는
  // 측정 시점에 따라 소수점이 갈려 테두리가 1px 흔들린다(전체의 0.05% 미만). 레이아웃이
  // 바뀌면 그보다 훨씬 큰 차이가 나므로 이 폭은 허용한다.
  await expect(page).toHaveScreenshot("overview.png", {
    fullPage: true,
    animations: "disabled",
    maxDiffPixels: 1200,
  });
});
