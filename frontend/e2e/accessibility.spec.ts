import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const route of ["/landing", "/app/overview", "/app/audits/new", "/app/guidelines"]) {
  test(`has no serious accessibility violations: ${route}`, async ({ page }) => {
    await page.goto(route);
    const expectedHeading =
      route === "/landing"
        ? /금융상품 UX를/
        : route === "/app/overview"
          ? "보험 가입 흐름 v1"
          : route === "/app/audits/new"
            ? "AI UX 진단 시작"
            : "금융 다크패턴 4개 범주";
    await page.getByRole("heading", { name: expectedHeading }).waitFor();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(serious).toEqual([]);
  });
}
