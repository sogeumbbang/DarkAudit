import { expect, test } from "@playwright/test";

test("dashboard manages multiple audits and links to their details", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/app/dashboard");
  await expect(page.getByRole("heading", { name: "대시보드", exact: true })).toBeVisible();
  if (isMobile) {
    const list = page.getByRole("list", { name: "진단 목록" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByText("보험 · 위험 후보 3건")).toBeVisible();
    await expect(list.getByText("2024. 5. 13.", { exact: true })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  } else {
    await expect(page.getByRole("columnheader")).toHaveText([
      "프로젝트",
      "상품 유형",
      "생성일",
      "위험 후보",
      "상태",
    ]);
    await expect(page.getByRole("cell", { name: "보험", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "2024. 5. 13.", exact: true })).toBeVisible();
  }
  await expect(page.locator("dl dd:first-of-type")).toHaveText(["2건", "0건", "1건", "3건"]);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
  await page.getByRole("link", { name: "보험 가입 흐름 v1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "진단 결과 상세", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "진단 관리", exact: true }).click();
  await expect(page.getByRole("heading", { name: "진단 기록", exact: true })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "메뉴 열기" }).click();
  const nav = page.getByRole("navigation", { name: "주요 메뉴" }).filter({ visible: true });
  await expect(nav.getByRole("link")).toHaveText(["대시보드", "새 진단", "진단 기록", "검토 기준"]);
  await expect(nav.getByText("진단 관리", { exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "새 진단", exact: true }).click();
  await expect(page.getByLabel("상품 유형")).toBeVisible();
  await page.getByLabel("상품 유형").selectOption("insurance");
});
