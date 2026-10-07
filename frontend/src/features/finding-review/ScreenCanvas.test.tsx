import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ScreenCanvas, ScreenCanvasLegend } from "@/features/finding-review/ScreenCanvas";
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
  it("selects primary and related marks by click or keyboard using the supplied report number", async () => {
    const onSelect = vi.fn();
    const onPan = vi.fn();
    render(
      <div onPointerDown={onPan}>
        <ScreenCanvas
          alt="화면"
          finding={finding}
          findings={[{ finding, number: 7 }]}
          onSelect={onSelect}
          screen={auditScreen}
        />
      </div>,
    );
    const image = screen.getByRole("img", { name: "화면" });
    Object.defineProperties(image, { offsetWidth: { value: 390 }, offsetHeight: { value: 844 } });
    fireEvent.load(image);
    const primary = screen.getByRole("button", { name: "7번 유료 옵션 사전 선택 탐지 영역" });
    const related = screen.getByRole("button", { name: "7번 유료 옵션 사전 선택 관련 영역" });
    expect(primary).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(primary);
    expect(onSelect).toHaveBeenLastCalledWith(finding);
    expect(onPan).not.toHaveBeenCalled();
    related.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(primary, { clientX: 10, clientY: 10 });
    fireEvent.click(primary, { clientX: 50, clientY: 50, detail: 1 });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it.each(["image", "normalized"] as const)(
    "centers %s coordinates once and recenters when requested",
    (coordinateSystem) => {
      const viewport = document.createElement("div");
      Object.defineProperties(viewport, {
        clientWidth: { value: 300 },
        clientHeight: { value: 400 },
      });
      viewport.getBoundingClientRect = () => ({ left: 20, top: 30 }) as DOMRect;
      viewport.scrollTo = vi.fn();
      const selected = {
        ...finding,
        bbox: {
          ...finding.bbox!,
          coordinateSystem,
          x: coordinateSystem === "normalized" ? 0.5 : 195,
          y: coordinateSystem === "normalized" ? 0.5 : 422,
          width: coordinateSystem === "normalized" ? 0.2 : 78,
          height: coordinateSystem === "normalized" ? 0.2 : 168.8,
        },
      };
      const props = {
        alt: "화면",
        finding: selected,
        screen: auditScreen,
        viewportRef: { current: viewport },
      };
      const { rerender } = render(<ScreenCanvas {...props} />);
      const image = screen.getByRole("img", { name: "화면" });
      Object.defineProperties(image, { offsetWidth: { value: 390 }, offsetHeight: { value: 844 } });
      image.getBoundingClientRect = () =>
        ({ left: 20, top: 30, width: 390, height: 844 }) as DOMRect;
      fireEvent.load(image);
      expect(viewport.scrollTo).toHaveBeenCalledWith({ left: 84, top: 306.4, behavior: "instant" });
      rerender(<ScreenCanvas {...props} />);
      expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
      rerender(<ScreenCanvas {...props} focusRequest={1} />);
      expect(viewport.scrollTo).toHaveBeenCalledTimes(2);
    },
  );

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

    const mark = screen.getByRole("img", { name: "DA-04 탐지 영역" });
    expect(mark).toHaveClass(
      "outline-[1.5px]",
      "outline-solid",
      "outline-offset-2",
      "outline-annotation",
    );
    expect(mark).not.toHaveClass("border-2", "bg-annotation/10");
    expect(mark).toBeEmptyDOMElement();
    expect(screen.getByRole("img", { name: "관련 영역" })).toBeEmptyDOMElement();
    expect(screen.queryByText("DA-04")).not.toBeInTheDocument();
    expect(screen.queryByText("관련")).not.toBeInTheDocument();
  });

  it("shows one legend per kind even when several related boxes overlap", () => {
    const overlapping = {
      ...finding,
      relatedElements: [...(finding.relatedElements ?? []), ...(finding.relatedElements ?? [])],
    };
    const { rerender } = render(
      <ScreenCanvasLegend screenId={auditScreen.id} finding={overlapping} />,
    );
    expect(screen.getByRole("group", { name: "탐지 표시 안내" })).not.toHaveClass("absolute");
    expect(screen.getAllByText("DA-04 탐지 영역")).toHaveLength(1);
    expect(screen.getAllByText("관련 영역")).toHaveLength(1);
    rerender(<ScreenCanvasLegend screenId="other-screen" finding={overlapping} />);
    expect(screen.queryByRole("group", { name: "탐지 표시 안내" })).not.toBeInTheDocument();
  });
});
