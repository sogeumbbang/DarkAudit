import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("shows browser frames and click history during a website audit", async ({
  page,
}, testInfo) => {
  // Intercept only job polling; the existing mock create/capture flow still runs.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/v1/analysis-jobs/")) {
        const frame = {
          profile: "mobile",
          imageUrl: `${location.origin}/sample-audit/02-preselected-addon.png`,
          width: 390,
          height: 844,
          fullPage: false,
        };
        return new Response(
          JSON.stringify({
            jobId: "visual-job",
            auditId: "visual-audit",
            status: "analyzing",
            progress: 12,
            explorationMode: "smart",
            source: "website",
            demo: true,
            explorationStage: "capturing",
            explorationEvents: [
              { ...frame, id: 1, kind: "capture", label: "첫 화면 확인" },
              {
                ...frame,
                id: 2,
                kind: "action",
                actionType: "click",
                label: "클릭 실행",
                x: 0.7,
                y: 0.65,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    };
  });
  await page.goto("/app/audits/new");
  await page.getByRole("button", { name: "URL 데모 실행", exact: true }).click();
  const viewer = page.getByRole("region", { name: "브라우저 탐색 과정" });
  await expect(viewer.getByText("COMPUTER USE")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/audits\/new\?job=/);
  const jobUrl = page.url();
  await page.reload();
  expect(page.url()).toBe(jobUrl);
  await expect(viewer.getByText("COMPUTER USE")).toBeVisible();
  await expect(viewer.getByRole("img", { name: "동작 위치" })).toBeVisible();
  await expect(viewer.getByText("조작 지점 확대")).toBeVisible();
  await expect
    .poll(() =>
      viewer.locator(".exploration-frame").evaluate((node) => getComputedStyle(node).transform),
    )
    .toMatch(/matrix\(1\.65/);
  const image = viewer.getByRole("img", { name: /클릭 실행 —/ });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await viewer.getByRole("button", { name: /1. 첫 화면 확인/ }).click();
  await expect(viewer.getByRole("img", { name: "동작 위치" })).toHaveCount(0);
  await expect(viewer.locator(".exploration-scan")).toHaveCount(0);
  await viewer.getByRole("button", { name: "최신 화면 보기" }).click();
  await expect(viewer.getByRole("img", { name: "동작 위치" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include(".exploration-viewer").analyze();
  expect(
    results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
  ).toEqual([]);
  await viewer.screenshot({ path: testInfo.outputPath("exploration-viewer.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(viewer.locator(".exploration-frame")).toHaveCSS("transition-duration", "0s");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const screen = await viewer.locator(".exploration-screen").boundingBox();
    const history = await viewer.locator(".exploration-history").boundingBox();
    expect(screen).not.toBeNull();
    expect(history).not.toBeNull();
    expect(screen!.x).toBeGreaterThanOrEqual(0);
    expect(history!.x + history!.width).toBeLessThanOrEqual(width);
    if (width <= 1024) expect(history!.y).toBeGreaterThan(screen!.y + screen!.height);
    else expect(history!.x).toBeGreaterThanOrEqual(screen!.x + screen!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
