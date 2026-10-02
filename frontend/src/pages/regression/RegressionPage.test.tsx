import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { regressionFixture } from "@/mocks/fixtures/regression";
import { server } from "@/mocks/server";

import { RegressionPage } from "./RegressionPage";

const auditId = dashboardFixture.audits[0]!.id;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/benchmark?audit=${auditId}`]}>
        <Routes>
          <Route path="/app/benchmark" element={<RegressionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RegressionPage", () => {
  it("shows a notice instead of an error when there is no earlier run (409)", async () => {
    renderPage();
    expect(await screen.findByText("아직 재진단 기록이 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows counts, resolved ratio and the findings of a selected category", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/audits/:auditId/regression", () => HttpResponse.json(regressionFixture)),
    );
    renderPage();

    const ratio = await screen.findByTestId("resolved-ratio");
    expect(within(ratio).getByText("50")).toBeInTheDocument();
    expect(within(ratio).getByText("이전 회차 문제 4건 중 2건 해결")).toBeInTheDocument();

    const resolved = screen.getByRole("button", { name: /해결/ });
    expect(resolved).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /재발/ })).toHaveTextContent("0");

    await user.click(resolved);
    const list = screen.getByRole("region", { name: "해결 항목" });
    expect(within(list).getByText("DA-04")).toBeInTheDocument();
    expect(within(list).getByText("특정옵션의 사전선택")).toBeInTheDocument();
  });

  it("re-uploads a revised screen, waits for the analysis and then shows the comparison", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("아직 재진단 기록이 없습니다")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "수정본 다시 올리기" }));
    const dialog = screen.getByRole("dialog", { name: "수정본 다시 올리기" });
    const file = new File(["png"], "revised-01.png", { type: "image/png" });
    await user.upload(within(dialog).getByLabelText("수정본 화면 파일 선택"), file);
    expect(within(dialog).getByText("revised-01.png")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "분석 시작" }));

    await waitFor(() => expect(screen.getByTestId("resolved-ratio")).toBeInTheDocument(), {
      timeout: 15_000,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /해결/ })).toHaveTextContent("2");
  }, 20_000);
});
