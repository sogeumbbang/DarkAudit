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

test("dashboard controls expose real content and navigation", async ({ page }) => {
  await page.goto("/app/overview");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();

  await page.getByRole("button", { name: /전체 흐름 보기/ }).click();
  await expect(page.getByRole("dialog", { name: "전체 가입 흐름" })).toBeVisible();
  await page.getByRole("button", { name: "닫기" }).click();

  await page.getByRole("button", { name: /개선 권고안 보기/ }).click();
  await expect(page.getByText(/추가 비용이 발생하는 옵션의 기본 선택을 해제/)).toBeVisible();
  await page.getByRole("button", { name: "다음 탐지 항목" }).click();
  await expect(page.getByRole("heading", { name: "감정적 압박" }).first()).toBeVisible();

  await page.getByRole("button", { name: "알림" }).click();
  await expect(page.getByText("새 진단이 완료되면 이곳에서 확인할 수 있습니다.")).toBeVisible();
  if (await page.getByRole("button", { name: "메뉴 열기" }).isVisible()) {
    await page.getByRole("button", { name: "메뉴 열기" }).click();
  }
  await page.getByRole("link", { name: "검토 기준", exact: true }).click();
  await expect(page.getByRole("heading", { name: "금융 다크패턴 4개 범주" })).toBeVisible();
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
