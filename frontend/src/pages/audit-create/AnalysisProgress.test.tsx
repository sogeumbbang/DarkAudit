import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AnalysisProgress } from "@/pages/audit-create/AnalysisProgress";

const props = {
  source: "website" as const,
  auditId: "audit-1",
  progress: 12,
  completed: false,
  failed: false,
  onBack: vi.fn(),
};

function renderProgress(overrides = {}) {
  return render(<AnalysisProgress {...props} {...overrides} />, { wrapper: MemoryRouter });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AnalysisProgress", () => {
  it("rotates guidance and counts time without inventing progress", () => {
    renderProgress();
    expect(screen.getByText("문구와 선택 구조를 함께 살펴봅니다")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("기본 선택 상태도 점검 대상입니다")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("0:07");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "12");
    expect(screen.queryByRole("link", { name: /결과 확인하기/ })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(53000));
    expect(screen.getByRole("timer")).toHaveTextContent("1:00");
    expect(screen.getByText(/시간이 더 걸릴 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "12");
  });

  it("stops animation and timers once the server reports completion", () => {
    const { rerender, container } = renderProgress({ progress: 100 });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "99");
    rerender(<AnalysisProgress {...props} completed progress={100} />);
    expect(screen.getByRole("heading", { name: "진단이 완료되었습니다" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /결과 확인하기/ })).toHaveAttribute(
      "href",
      "/app/overview?audit=audit-1",
    );
    expect(container.querySelector(".analysis-scan-line")).toBeNull();
    expect(container.querySelector(".analysis-progress-sweep")).toBeNull();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops waiting on failure and preserves the actionable error", () => {
    const { rerender } = renderProgress();
    rerender(<AnalysisProgress {...props} failed error="연결을 확인해 주세요" />);
    expect(screen.getByText("연결을 확인해 주세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "입력 화면으로 돌아가기" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up its timer when the progress screen closes", () => {
    const { unmount } = renderProgress();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
