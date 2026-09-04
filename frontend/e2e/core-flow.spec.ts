import { expect, test } from "@playwright/test";

// 데모에서 첫 화면이 바로 결과가 되도록 "/" 는 대시보드로 보낸다.
test("root redirects to the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/app\/overview$/);
  await expect(page.getByRole("heading", { name: "보험 가입 흐름 v1" })).toBeVisible();
});

test("landing page opens the audit dashboard", async ({ page }) => {
  await page.goto("/landing");
  await expect(page.getByRole("heading", { name: /금융상품 UX를/ })).toBeVisible();
  await page.getByRole("link", { name: "진단 시작하기" }).first().click();
  await expect(page.getByRole("heading", { name: "보험 가입 흐름 v1" })).toBeVisible();
});

test("user creates an audit and completes analysis", async ({ page }) => {
  await page.goto("/app/audits/new");
  await page.getByLabel("진단 이름").fill("Playwright 가입 흐름");
  await page.getByRole("tab", { name: /스크린샷/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "option-screen.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "분석 시작하기" }).click();
  await expect(page.getByRole("heading", { name: "진단이 완료되었습니다" })).toBeVisible({
    timeout: 15_000,
  });
});

test("finding can be marked as resolved", async ({ page }) => {
  await page.goto("/app/overview?finding=finding-preselected-option");
  await expect(page.getByText("검토 필요").first()).toBeVisible();
  await page.getByRole("button", { name: "해결됨으로 표시" }).click();
  await expect(page.getByText("해결됨").first()).toBeVisible();
});
