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

    expect(screen.getByRole("heading", { name: /금융상품 UX를/ })).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "진단 시작하기" })) {
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
    const standards = screen.getByRole("region", { name: "15개 기준을 모두 공개합니다." });
    expect(within(standards).getAllByRole("listitem")).toHaveLength(15);
    const automated = within(standards)
      .getAllByRole("listitem")
      .filter((item) => item.textContent?.includes("MVP 자동 탐지"));
    expect(automated.map((item) => item.querySelector("summary > span")?.textContent)).toEqual([
      "03",
      "04",
      "07",
      "12",
      "15",
    ]);
    expect(screen.getAllByRole("link", { name: "진단 시작하기" })).toHaveLength(2);
  });
});
