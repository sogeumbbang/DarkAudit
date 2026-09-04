import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { OverviewPage } from "@/pages/overview/OverviewPage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/app/overview"]}>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OverviewPage", () => {
  it("loads dashboard data and changes the selected audit", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByLabelText("대시보드 불러오는 중")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "보험 가입 흐름 v1" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "상품 안내 캡처 화면 미리보기" })).toHaveAttribute(
      "src",
      expect.stringContaining("/mock/intro.png"),
    );

    await user.click(screen.getByText("적금 가입 흐름 v2"));

    expect(screen.getByRole("heading", { name: "적금 가입 흐름 v2" })).toBeInTheDocument();
    expect(screen.getByText("탐지된 항목이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "상품 안내 캡처 화면 미리보기" })).toHaveAttribute(
      "src",
      expect.stringContaining("/mock/savings.png"),
    );
  });

  it("opens flow, recommendation, metadata, and navigates findings", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "보험 가입 흐름 v1" });

    await user.click(screen.getByRole("button", { name: /전체 흐름 보기/ }));
    expect(screen.getByRole("dialog", { name: "전체 가입 흐름" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "닫기" }));

    await user.click(screen.getByRole("button", { name: /개선 권고안 보기/ }));
    expect(screen.getByText(/추가 비용이 발생하는 옵션의 기본 선택을 해제/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "탐지 메타데이터" }));
    expect(screen.getByText(/신뢰도 94%/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 탐지 항목" }));
    expect(screen.getAllByRole("heading", { name: "감정적 압박" })[0]).toBeInTheDocument();
  });
});
