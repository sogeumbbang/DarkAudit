import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// 공개 첫 화면은 랜딩이다.
test("root shows the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /다 만든 화면,/ })).toBeVisible();
});

// 로고 링크와 이미 공유된 링크가 /landing 을 쓴다. 같은 화면이어야 한다.
test("landing alias serves the same page", async ({ page }) => {
  await page.goto("/landing");
  await expect(page.getByRole("heading", { name: /다 만든 화면,/ })).toBeVisible();
});

test("overview logo opens the landing page", async ({ page }) => {
  await page.goto("/app/overview");
  await page.locator('a[href="/landing"]:visible').first().click();
  await expect(page).toHaveURL(/\/landing$/);
  await expect(page.getByRole("heading", { name: /다 만든 화면,/ })).toBeVisible();
});

test("landing page opens a new audit directly", async ({ page }) => {
  await page.goto("/landing");
  await expect(page.getByRole("heading", { name: /다 만든 화면,/ })).toBeVisible();
  await page.getByRole("link", { name: "내 화면 점검하기" }).click();
  await expect(page).toHaveURL(/\/app\/audits\/new$/);
});

test("landing keeps navigation visible and exposes all review criteria", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/landing");
  const navigation = page.getByRole("navigation", { name: "랜딩 메뉴" });
  if (isMobile) {
    await expect(navigation).toBeHidden();
    await page.getByRole("button", { name: "랜딩 메뉴 열기" }).click();
    await expect(navigation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(page.getByRole("button", { name: "랜딩 메뉴 열기" })).toBeFocused();
  } else {
    await expect(navigation).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("landing-hero.png") });
  if (isMobile) await page.getByRole("button", { name: "랜딩 메뉴 열기" }).click();
  await navigation.getByRole("link", { name: "검토 기준" }).click();
  await expect(page).toHaveURL(/\/app\/guidelines$/);
  await expect(page.getByRole("heading", { name: "금융 다크패턴 4개 범주" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("app opens the management dashboard by default", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/dashboard$/);
});

test("audit list opens results and returns to the list", async ({ page }, testInfo) => {
  await page.goto("/app/audits");
  await expect(page.getByRole("heading", { name: "진단 기록" })).toBeVisible();
  await expect(page.getByRole("link", { name: "보험 가입 흐름 v1", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("audit-list.png"), fullPage: true });
  await page.getByRole("link", { name: "보험 가입 흐름 v1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "보험 가입 흐름 v1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 진단" })).toHaveCount(0);
  await page.getByRole("link", { name: "진단 관리" }).click();
  await expect(page.getByRole("heading", { name: "진단 기록" })).toBeVisible();
});

test("dashboard controls expose real content and navigation", async ({ page }) => {
  await page.goto("/app/overview");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();

  await page.getByRole("button", { name: /전체 흐름 보기/ }).click();
  const flow = page.getByRole("dialog", { name: "전체 가입 흐름" });
  await expect(flow).toBeVisible();
  await page.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: /전체 흐름 보기/ }).click();
  const heading = flow.getByRole("heading", { name: "전체 가입 흐름" });
  await heading.click();
  await expect(flow).toBeVisible();
  const headingBounds = (await heading.boundingBox())!;
  await page.mouse.move(headingBounds.x + 4, headingBounds.y + 4);
  await page.mouse.down();
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await expect(flow).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(flow).toHaveCount(0);

  await page.getByRole("button", { name: "다음 미검토 항목", exact: true }).click();
  await expect(page.getByRole("heading", { name: "개선 권고안" })).toBeVisible();
  await expect(page.getByText(/추가 비용이 발생하는 옵션의 기본 선택을 해제/)).toBeVisible();
  await page.getByRole("button", { name: "다음 탐지 항목" }).click();
  await expect(page.getByRole("heading", { name: "감정적 압박" }).first()).toBeVisible();

  await expect(page.getByRole("button", { name: "알림" })).toHaveCount(0);
  await page.getByRole("button", { name: "상세 설명 닫기" }).click();
  if (await page.getByRole("button", { name: "메뉴 열기" }).isVisible()) {
    await page.getByRole("button", { name: "메뉴 열기" }).click();
  }
  await page.getByRole("link", { name: "검토 기준", exact: true }).click();
  await expect(page.getByRole("heading", { name: "금융 다크패턴 4개 범주" })).toBeVisible();
});

test("map preview zooms real image pixels and supports panning and reset", async ({ page }) => {
  await page.goto("/app/overview");
  const viewport = page.getByTestId("screen-preview-viewport");
  const image = viewport.getByRole("img", { name: /캡처 화면 미리보기/ });
  await expect(image).toBeVisible();
  const initial = (await image.boundingBox())!;
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "확대", exact: true }).click();
  await expect(page.getByLabel("미리보기 배율")).toHaveText("200%");
  await expect
    .poll(async () => (await image.boundingBox())!.width / initial.width)
    .toBeCloseTo(2, 1);
  await viewport.scrollIntoViewIfNeeded();
  const area = (await viewport.boundingBox())!;
  await page.mouse.move(area.x + 15, area.y + 90);
  await page.mouse.down();
  await expect(viewport).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(area.x + 15, area.y + 30);
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await viewport.evaluate((el) => el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth }));
  expect(await viewport.evaluate((el) => el.scrollTop === el.scrollHeight - el.clientHeight)).toBe(
    true,
  );
  await page.getByRole("button", { name: "화면 전체 보기", exact: true }).click();
  await expect(page.getByLabel("미리보기 배율")).toHaveText("100%");
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
});

test("map pins open a focused explanation and keep PDF numbering", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/app/overview");
  const viewport = page.getByTestId("screen-preview-viewport");
  const related = viewport.getByRole("button", { name: "3번 순차적 가격 공개 관련 영역" });
  await expect(related).toBeVisible();
  await expect(page.locator("#finding-detail-panel")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "점검 항목" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("map-overview.png"), fullPage: true });
  await related.click();
  const panel = page.locator("#finding-detail-panel");
  await expect(panel.getByRole("heading", { name: "순차적 가격 공개" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "탐지 항목 상세" })).toBeFocused();
  await expect(page).toHaveURL(/screen=screen-option/);
  await expect(related).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => parseInt((await page.getByLabel("미리보기 배율").textContent())!))
    .toBeGreaterThan(100);
  await expect(panel.getByLabel("항목 3번")).toHaveText("3");
  const selectedImage = viewport.getByRole("img", { name: /캡처 화면 미리보기/ });
  const imageBounds = (await selectedImage.boundingBox())!;
  const markBounds = (await related.boundingBox())!;
  expect(markBounds.x).toBeCloseTo(imageBounds.x + (imageBounds.width * 24) / 390 - 2, 0);
  expect(markBounds.y).toBeCloseTo(imageBounds.y + (imageBounds.height * 760) / 844 - 2, 0);
  if (isMobile) {
    await expect
      .poll(async () => {
        const marker = (await related.boundingBox())!;
        const pane = (await panel.boundingBox())!;
        return marker.y >= 0 && marker.y + marker.height <= pane.y;
      })
      .toBe(true);
  }
  if (!isMobile) {
    const pane = (await panel.boundingBox())!;
    const map = (await viewport.boundingBox())!;
    expect(pane.x).toBeGreaterThanOrEqual(map.x + map.width - 1);
  }
  await page.screenshot({ path: testInfo.outputPath("map-selected.png"), fullPage: !isMobile });
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
  ).toEqual([]);
  if (isMobile) {
    await page.keyboard.press("Shift+Tab");
    await expect(panel.locator(":focus")).toHaveCount(1);
  }
  if (isMobile)
    await page
      .getByRole("button", { name: "상세 설명 바깥 여백" })
      .click({ position: { x: 5, y: 5 } });
  else await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("미리보기 배율")).toHaveText("100%");
  await page.getByRole("button", { name: "문제 목록", exact: true }).click();
  const list = page.getByRole("navigation", { name: "점검 항목" });
  await page
    .getByRole("group", { name: "점검 항목 필터" })
    .getByRole("button", { name: "해결됨 1" })
    .click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByRole("button")).toContainText("3");
  await list.getByRole("button").click();
  await expect(page).toHaveURL(/screen=screen-review/);
  await expect(panel.getByLabel("항목 3번")).toHaveText("3");
  await page.getByRole("button", { name: "상세 설명 닫기" }).click();
  const primary = viewport.getByRole("button", { name: "3번 순차적 가격 공개 탐지 영역" });
  await primary.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading", { name: "탐지 항목 상세" })).toBeFocused();
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

test("review filters separate severity and status and advance after resolving", async ({
  page,
  isMobile,
}) => {
  await page.goto("/app/overview?list=1&filter=needs-review&finding=finding-preselected-option");
  const list = page.getByRole("navigation", { name: "점검 항목" });
  const filters = page.getByRole("group", { name: "점검 항목 필터" });
  const panel = page.locator("#finding-detail-panel");
  await expect(panel.getByText("심각도 높음", { exact: true })).toBeVisible();
  await expect(panel.getByText("검토 중", { exact: true })).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(2);
  await page.reload();
  await expect(filters.getByRole("button", { name: "검토 필요 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "해결하고 다음 미검토 항목" }).click();
  await expect(panel.getByRole("heading", { name: "감정적 압박" })).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "해결됨으로 표시" }).click();
  await expect(panel.getByRole("heading", { name: "검토가 필요한 항목이 없습니다" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 미검토 항목", exact: true })).toBeDisabled();
  if (isMobile) await page.getByRole("button", { name: "상세 설명 닫기" }).click();
  await filters.getByRole("button", { name: "해결됨 3" }).click();
  await expect(list.getByRole("button")).toHaveCount(3);
  if (isMobile) await list.getByRole("button", { name: /유료 옵션 사전 선택/ }).click();
  await page.getByRole("button", { name: "검토 상태로 되돌리기" }).click();
  if (isMobile) await page.getByRole("button", { name: "상세 설명 닫기" }).click();
  await filters.getByRole("button", { name: "검토 필요 1" }).click();
  if (isMobile) await list.getByRole("button", { name: /유료 옵션 사전 선택/ }).click();
  await expect(panel.getByText("검토 중", { exact: true })).toBeVisible();
});

test("audit can be deleted from the management page", async ({ page }) => {
  await page.goto("/app/audits");
  const target = page.getByRole("listitem").filter({ hasText: "적금 가입 흐름 v2" });
  await expect(target).toBeVisible();

  // 실수로 지우는 일이 없도록 한 번 더 확인받는다.
  await target.getByRole("button", { name: /삭제/ }).click();
  await expect(page.getByText("화면과 탐지 결과가 함께 삭제됩니다.")).toBeVisible();
  await target.getByRole("button", { name: "삭제", exact: true }).click();

  await expect(target).toHaveCount(0);
  await expect(page.getByText("보험 가입 흐름 v1")).toBeVisible();
});
