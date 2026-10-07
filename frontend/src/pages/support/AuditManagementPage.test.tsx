import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";
import { AuditManagementPage } from "./SupportPages";

function setup() {
  const fixture = structuredClone(dashboardFixture);
  const [representative, regular] = fixture.audits;
  const demo = { ...structuredClone(regular!), id: "audit-other-demo" };
  fixture.audits.push(demo);
  representative!.name = "대표 데모 진단";
  representative!.demoPreset = { scenario: "pet", source: "screenshots" };
  representative!.deletionProtected = true;
  demo.name = "다른 데모 진단";
  demo.demoPreset = { scenario: "pet", source: "screenshots" };
  demo.deletionProtected = false;
  regular!.name = "일반 진단";
  regular!.demoPreset = null;
  server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuditManagementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AuditManagementPage", () => {
  it("locks deletion of the protected representative demo and explains why", async () => {
    const user = userEvent.setup();
    setup();
    const row = (await screen.findByText("대표 데모 진단")).closest("li")!;
    const button = within(row).getByRole("button", { name: "대표 데모 진단 삭제" });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("대표 데모 진단은 삭제할 수 없습니다");
    expect(within(row).getByRole("tooltip")).toHaveTextContent(
      "대표 데모 진단은 삭제할 수 없습니다",
    );

    await user.click(button);
    expect(within(row).queryByText("화면과 탐지 결과가 함께 삭제됩니다.")).not.toBeInTheDocument();
  });

  it.each(["다른 데모 진단", "일반 진단"])("keeps the confirmation flow for %s", async (name) => {
    const user = userEvent.setup();
    setup();
    const row = (await screen.findByText(name)).closest("li")!;
    const button = within(row).getByRole("button", { name: `${name} 삭제` });

    expect(button).not.toHaveAttribute("aria-disabled");
    expect(within(row).queryByRole("tooltip")).not.toBeInTheDocument();
    await user.click(button);
    expect(within(row).getByText("화면과 탐지 결과가 함께 삭제됩니다.")).toBeVisible();
  });
});
