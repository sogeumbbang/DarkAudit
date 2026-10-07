import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/layouts/AppLayout";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderLayout(path = "/app/overview") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<AppLayout />}>
          <Route path="overview" element={<h1>대시보드 내용</h1>} />
          <Route path="audits" element={<h1>진단 기록 내용</h1>} />
          <Route path="audits/new" element={<h1>새 진단 내용</h1>} />
          <Route path="guidelines" element={<h1>검토 기준 내용</h1>} />
          <Route path="settings" element={<h1>설정 내용</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout", () => {
  it.each(["overview", "audits", "audits/new", "guidelines", "settings"])(
    "removes the header and comparison menu on %s",
    (path) => {
      renderLayout(`/app/${path}`);
      expect(screen.queryByRole("banner")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "알림" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "비교 분석" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading")).toBeInTheDocument();
    },
  );

  it("collapses the desktop sidebar into named icon links", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout("/app/audits");
    const sidebar = container.querySelector<HTMLElement>("aside.workspace-sidebar")!;
    const toggle = screen.getByRole("button", { name: "사이드바 접기" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(sidebar).toHaveTextContent("진단 관리");
    expect(sidebar).toHaveTextContent("금융상품 화면을 검토하고");

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(sidebar).toHaveClass("is-collapsed");
    expect(sidebar).not.toHaveTextContent("진단 관리");
    expect(sidebar).not.toHaveTextContent("금융상품 화면을 검토하고");
    for (const name of ["대시보드", "새 진단", "진단 기록", "검토 기준"]) {
      const link = screen.getByRole("link", { name });
      expect(link.querySelector(".workspace-sidebar-tooltip")).toHaveTextContent(name);
    }
    expect(screen.getByRole("link", { name: "진단 기록" })).toHaveAttribute("aria-current", "page");
    // Keyboard users move from the toggle straight into the icon links.
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "대시보드" })).toHaveFocus();
  });

  it("keeps mobile navigation available without the overview header", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getAllByRole("button", { name: "메뉴 닫기" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "비교 분석" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("link", { name: "진단 기록" }).at(-1)!);
    expect(screen.getByRole("heading", { name: "진단 기록 내용" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "메뉴 닫기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "알림" })).not.toBeInTheDocument();
  });
});
