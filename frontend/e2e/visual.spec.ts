import { expect, type Page, test } from "@playwright/test";

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // 이미지가 다 실려야 한다. bbox 오버레이는 렌더링된 <img> 박스를 실측해서
    // 그 위에 그리는데, 로드 전에 찍으면 아직 자리를 못 잡은 상태가 남는다.
    // absolute 라 문서 높이에 영향을 주지 않아 아래 높이 안정화로는 잡히지 않는다.
    await Promise.all(
      [...document.images]
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
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
  await page.getByRole("heading", { name: /금융상품 UX를/ }).waitFor();
  await waitForStableLayout(page);
  await expect(page).toHaveScreenshot("landing.png", { fullPage: true, animations: "disabled" });
});

test("overview visual", async ({ page }) => {
  await page.goto("/app/overview");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();
  await waitForStableLayout(page);
  // bbox 오버레이는 렌더링된 <img> 박스를 실측해 퍼센트로 얹는다. 축소된 미리보기에서는
  // 측정 시점에 따라 소수점이 갈려 테두리가 1px 흔들린다(전체의 0.05% 미만). 레이아웃이
  // 바뀌면 그보다 훨씬 큰 차이가 나므로 이 폭은 허용한다.
  await expect(page).toHaveScreenshot("overview.png", {
    fullPage: true,
    animations: "disabled",
    maxDiffPixels: 1200,
  });
});
