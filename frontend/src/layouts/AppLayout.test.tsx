import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/layouts/AppLayout";

function renderLayout(path = "/app/overview") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<AppLayout />}>
          <Route path="overview" element={<h1>대시보드 내용</h1>} />
          <Route path="audits" element={<h1>진단 관리 내용</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout", () => {
  it("removes the overview header and comparison menu", () => {
    renderLayout();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "알림" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "비교 분석" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "대시보드 내용" })).toBeInTheDocument();
  });

  it("keeps mobile navigation available without the overview header", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getAllByRole("button", { name: "메뉴 닫기" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "비교 분석" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("link", { name: "진단 관리" }).at(-1)!);
    expect(screen.getByRole("heading", { name: "진단 관리 내용" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "메뉴 닫기" })).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();
  });
});
