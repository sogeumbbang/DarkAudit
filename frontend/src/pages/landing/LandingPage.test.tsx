import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LandingPage } from "@/pages/landing/LandingPage";

describe("LandingPage", () => {
  it("introduces the product and links directly to a new audit", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /다 만든 화면,/ })).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: /진단 시작하기|내 화면 점검하기/ })) {
      expect(link).toHaveAttribute("href", "/app/audits/new");
    }
    expect(screen.queryByText(/로그인|회원가입/)).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "랜딩 메뉴" });
    expect(within(navigation).getByRole("link", { name: "대시보드" })).toHaveAttribute(
      "href",
      "/app/dashboard",
    );
    const process = screen.getByRole("region", { name: "화면 입력부터 검토 결과 관리까지" });
    expect(
      within(process)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["화면 입력", "AI 진단", "담당자 검토", "결과 관리"]);
    expect(within(navigation).getByRole("link", { name: "검토 기준" })).toHaveAttribute(
      "href",
      "/app/guidelines",
    );
    expect(screen.getByRole("link", { name: /화면 등록하고 시작하기/ })).toHaveAttribute(
      "href",
      "/app/audits/new",
    );
  });
});
