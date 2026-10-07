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
  const [demo, regular] = fixture.audits;
  demo!.name = "데모 진단";
  demo!.demoPreset = { scenario: "pet", source: "screenshots" };
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
  it("locks deletion of demo audits and explains why", async () => {
    const user = userEvent.setup();
    setup();
    const row = (await screen.findByText("데모 진단")).closest("li")!;
    const button = within(row).getByRole("button", { name: "데모 진단 삭제" });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("데모 진단은 삭제할 수 없습니다");
    expect(within(row).getByRole("tooltip")).toHaveTextContent("데모 진단은 삭제할 수 없습니다");

    await user.click(button);
    expect(within(row).queryByText("화면과 탐지 결과가 함께 삭제됩니다.")).not.toBeInTheDocument();
  });

  it("keeps the confirmation flow for regular audits", async () => {
    const user = userEvent.setup();
    setup();
    const row = (await screen.findByText("일반 진단")).closest("li")!;
    const button = within(row).getByRole("button", { name: "일반 진단 삭제" });

    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    expect(within(row).getByText("화면과 탐지 결과가 함께 삭제됩니다.")).toBeVisible();
  });
});
