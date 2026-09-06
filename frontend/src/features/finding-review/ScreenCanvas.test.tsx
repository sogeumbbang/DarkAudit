import { fireEvent, render, screen } from "@testing-library/react";

import { ScreenCanvas } from "@/features/finding-review/ScreenCanvas";
import type { AuditScreenDto, FindingDto } from "@/entities/audit/types";

const auditScreen: AuditScreenDto = {
  id: "screen-01",
  order: 1,
  flowStep: "유료 옵션",
  imageUrl: "/screen.png",
  findingCount: 1,
  width: 390,
  height: 844,
};

const finding: FindingDto = {
  id: "finding-1",
  ruleId: "DA-04",
  riskType: "PRESELECTED_OPTION",
  title: "유료 옵션 사전 선택",
  description: "선택됨",
  screenIds: ["screen-01"],
  element: "안심케어 플러스 체크박스",
  severity: "HIGH",
  status: "open",
  confidence: 0.93,
  recommendation: "기본 선택을 해제합니다.",
  guideline: "사전 선택 금지",
  bbox: {
    screenId: "screen-01",
    x: 44,
    y: 292,
    width: 28,
    height: 28,
    coordinateSystem: "image",
  },
  relatedElements: [
    {
      screenId: "screen-01",
      description: "대립 선택지",
      bbox: {
        screenId: "screen-01",
        x: 140,
        y: 785,
        width: 109,
        height: 25,
        coordinateSystem: "image",
      },
    },
  ],
};

describe("ScreenCanvas", () => {
  it("draws compact control marks outside the evidence pixels", () => {
    render(<ScreenCanvas alt="화면" finding={finding} screen={auditScreen} />);
    const image = screen.getByRole("img", { name: "화면" });
    fireEvent.load(image);
    expect(screen.queryByText("DA-04")).not.toBeInTheDocument();
    Object.defineProperties(image, {
      offsetWidth: { value: 390 },
      offsetHeight: { value: 844 },
    });
    fireEvent.load(image);

    const label = screen.getByText("DA-04");
    const mark = label.parentElement;
    expect(mark).toHaveClass(
      "outline-[1.5px]",
      "outline-solid",
      "outline-offset-2",
      "outline-danger",
    );
    expect(mark).not.toHaveClass("border-2", "bg-danger/10");
    expect(label).toHaveClass("bottom-full", "mb-1");
    expect(screen.getByText("관련")).toHaveClass("top-full", "mt-1");
  });
});
