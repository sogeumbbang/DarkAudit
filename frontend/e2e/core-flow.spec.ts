import { expect, test } from "@playwright/test";

// 데모에서 첫 화면이 바로 결과가 되도록 "/" 는 대시보드로 보낸다.
test("root shows the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /금융상품 UX를/ })).toBeVisible();
});

// 로고 링크와 이미 공유된 링크가 /landing 을 쓴다. 같은 화면이어야 한다.
test("landing alias serves the same page", async ({ page }) => {
  await page.goto("/landing");
  await expect(page.getByRole("heading", { name: /금융상품 UX를/ })).toBeVisible();
});

test("overview logo opens the landing page", async ({ page }) => {
  await page.goto("/app/overview");
  await page.locator('a[href="/landing"]:visible').first().click();
  await expect(page).toHaveURL(/\/landing$/);
  await expect(page.getByRole("heading", { name: /금융상품 UX를/ })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "개선 권고안" })).toBeVisible();
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

test("zoomed preview can be dragged and scrolled to every image edge", async ({
  page,
  isMobile,
}) => {
  await page.goto("/app/overview");
  await page.getByRole("heading", { name: "보험 가입 흐름 v1" }).waitFor();

  const viewport = page.getByTestId("screen-preview-viewport");
  await expect(viewport).toHaveCSS("overflow", "auto");
  await expect(viewport).toHaveCSS("scrollbar-width", "none");
  await expect(viewport).toHaveCSS("cursor", "grab");
  const baseViewportBox = await viewport.boundingBox();
  expect(baseViewportBox).not.toBeNull();
  if (!isMobile) {
    await page.mouse.move(
      baseViewportBox!.x + baseViewportBox!.width / 2,
      baseViewportBox!.y + baseViewportBox!.height / 2,
    );
    await page.mouse.down();
    await expect(viewport).toHaveCSS("cursor", "grabbing");
    await page.mouse.up();
    await expect(viewport).toHaveCSS("cursor", "grab");
  }

  // 서버의 이미지 좌표가 실제 렌더링된 이미지 박스에 같은 비율로 매핑되는지
  // 확인한다. 바깥 카드나 스크롤 영역을 기준으로 잡으면 이 값이 어긋난다.
  const imageBox = await page
    .getByRole("img", { name: "옵션 선택 캡처 화면 미리보기" })
    .boundingBox();
  const highlightBox = await viewport
    .getByText("DA-04", { exact: true })
    .locator("..")
    .boundingBox();
  expect(imageBox).not.toBeNull();
  expect(highlightBox).not.toBeNull();
  expect(highlightBox!.x).toBeCloseTo(imageBox!.x + imageBox!.width * (24 / 390), 0);
  expect(highlightBox!.y).toBeCloseTo(imageBox!.y + imageBox!.height * (520 / 844), 0);
  expect(highlightBox!.width).toBeCloseTo(imageBox!.width * (342 / 390), 0);
  expect(highlightBox!.height).toBeCloseTo(imageBox!.height * (48 / 844), 0);

  await page.getByRole("button", { name: "확대" }).click();
  await page.getByRole("button", { name: "확대" }).click();
  await expect(viewport).toHaveCSS("overflow", "auto");
  await expect(viewport).toHaveCSS("scrollbar-width", "none");

  await expect
    .poll(() =>
      viewport.evaluate(
        (element) =>
          element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  const scrollRange = await viewport.evaluate((element) => ({
    x: element.scrollWidth - element.clientWidth,
    y: element.scrollHeight - element.clientHeight,
  }));
  expect(scrollRange.x).toBeGreaterThan(0);
  expect(scrollRange.y).toBeGreaterThan(0);

  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).not.toBeNull();
  await page.mouse.move(
    viewportBox!.x + viewportBox!.width / 2,
    viewportBox!.y + viewportBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    viewportBox!.x + viewportBox!.width / 2 - 60,
    viewportBox!.y + viewportBox!.height / 2 - 60,
  );
  await page.mouse.up();
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft > 0 && element.scrollTop > 0))
    .toBe(true);
  const draggedPosition = await viewport.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  expect(draggedPosition.left).toBeGreaterThan(0);
  expect(draggedPosition.top).toBeGreaterThan(0);

  const reachedEnd = await viewport.evaluate((element) => {
    element.scrollTo({ left: element.scrollWidth, top: element.scrollHeight });
    return {
      x: element.scrollLeft === element.scrollWidth - element.clientWidth,
      y: element.scrollTop === element.scrollHeight - element.clientHeight,
    };
  });
  expect(reachedEnd).toEqual({ x: true, y: true });
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
