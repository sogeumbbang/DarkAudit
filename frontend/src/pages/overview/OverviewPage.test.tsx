import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
    // 첫 진입에서 미리보기는 화면 1이 아니라 선택된 탐지 항목(DA-04)이 있는
    // 화면이어야 한다. 둘이 어긋나면 위치 강조가 보이지 않는다.
    expect(screen.getByRole("img", { name: "옵션 선택 캡처 화면 미리보기" })).toHaveAttribute(
      "src",
      expect.stringContaining("/mock/option.png"),
    );

    await user.click(screen.getByText("적금 가입 흐름 v2"));

    expect(screen.getByRole("heading", { name: "적금 가입 흐름 v2" })).toBeInTheDocument();
    expect(screen.getByText("탐지된 항목이 없습니다")).toBeInTheDocument();
    // 탐지 항목이 없으면 기존대로 첫 화면을 보여준다.
    expect(screen.getByRole("img", { name: "상품 안내 캡처 화면 미리보기" })).toHaveAttribute(
      "src",
      expect.stringContaining("/mock/savings.png"),
    );
  });

  it("opens flow, recommendation, metadata, and navigates findings", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "보험 가입 흐름 v1" });

    const previewImage = screen.getByRole("img", { name: /캡처 화면 미리보기/ });
    const previewViewport = screen.getByTestId("screen-preview-viewport");
    const previewScrollArea = screen.getByTestId("screen-preview-scroll-area");
    expect(previewViewport).toHaveClass("overflow-hidden");
    await user.click(screen.getByRole("button", { name: "확대" }));
    expect(previewViewport).toHaveClass("overflow-auto");
    expect(previewViewport).toHaveClass("cursor-grab");
    expect(previewScrollArea).toHaveStyle({ height: "120%", width: "120%" });
    expect(previewImage.parentElement).not.toHaveStyle({ transform: "scale(1.2)" });
    fireEvent.pointerDown(previewViewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(previewViewport, { clientX: 70, clientY: 60, pointerId: 1 });
    expect(previewViewport.scrollLeft).toBe(30);
    expect(previewViewport.scrollTop).toBe(40);
    expect(previewViewport).toHaveClass("cursor-grabbing");
    fireEvent.pointerUp(previewViewport, { pointerId: 1 });
    expect(previewViewport).toHaveClass("cursor-grab");
    await user.click(screen.getByRole("button", { name: "배율 초기화" }));
    expect(previewViewport).toHaveClass("overflow-hidden");
    expect(previewScrollArea).toHaveStyle({ height: "100%", width: "100%" });

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

  it("steps through every finding with the detail arrows", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "보험 가입 흐름 v1" })).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    // 카드는 3건까지만 노출되므로 그 뒤 항목은 화살표로만 닿는다.
    await user.click(screen.getByRole("button", { name: "다음 탐지 항목" }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    // 처음에서 이전으로 가면 마지막으로 돌아온다.
    await user.click(screen.getByRole("button", { name: "이전 탐지 항목" }));
    await user.click(screen.getByRole("button", { name: "이전 탐지 항목" }));
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });
});
