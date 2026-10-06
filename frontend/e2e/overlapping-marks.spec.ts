import { expect, test } from "@playwright/test";
import { dashboardFixture } from "../src/mocks/fixtures/dashboard";

test("overlapping finding numbers remain clickable after selecting a large region", async ({
  page,
}, testInfo) => {
  const fixture = structuredClone(dashboardFixture);
  const audit = fixture.audits[0]!;
  audit.status = "completed";
  audit.findings[0]!.bbox = {
    screenId: "screen-option",
    x: 24,
    y: 100,
    width: 342,
    height: 600,
    coordinateSystem: "image",
  };
  audit.findings[2]!.relatedElements![0]!.bbox = {
    screenId: "screen-option",
    x: 140,
    y: 400,
    width: 180,
    height: 36,
    coordinateSystem: "image",
  };
  await page.addInitScript((data) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url, location.origin).pathname === "/api/v1/dashboard/summary") {
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  }, fixture);
  await page.goto("/app/overview");
  const viewport = page.getByTestId("screen-preview-viewport");
  const first = viewport.getByRole("button", { name: "1번 유료 옵션 사전 선택 탐지 영역" });
  const second = viewport.getByRole("button", { name: "2번 순차적 가격 공개 관련 영역" });
  await first.locator("span").click();
  await expect(first).toHaveAttribute("aria-pressed", "true");

  // Exercise browser hit testing: a DOM-dispatched click would miss this regression.
  const region = (await first.boundingBox())!;
  const marker = (await second.locator("span").boundingBox())!;
  expect(marker.x + marker.width / 2).toBeGreaterThan(region.x);
  expect(marker.x + marker.width / 2).toBeLessThan(region.x + region.width);
  expect(marker.y + marker.height / 2).toBeGreaterThan(region.y);
  expect(marker.y + marker.height / 2).toBeLessThan(region.y + region.height);
  await second.locator("span").click({ timeout: 5000 });
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#finding-detail-panel")).toHaveAttribute(
    "aria-label",
    "순차적 가격 공개 설명",
  );
  await page.screenshot({ path: testInfo.outputPath("overlapping-marks.png") });

  await first.locator("span").click();
  await second.focus();
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-pressed", "true");
});
