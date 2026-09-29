import { fireEvent, render, screen } from "@testing-library/react";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { ReportScreen } from "./ReportScreen";

const audit = dashboardFixture.audits[0]!;

it("marks primary and related evidence on the current screen with report numbers", () => {
  const { container } = render(
    <ReportScreen
      screen={audit.screens[1]!}
      findings={audit.findings.map((finding, index) => ({ finding, number: index + 1 }))}
    />,
  );
  expect(screen.getByLabelText("1. 유료 옵션 사전 선택 탐지 영역")).toHaveTextContent("1");
  expect(screen.getByLabelText("3. 순차적 가격 공개 관련 영역")).toHaveTextContent("3");
  expect(screen.queryByLabelText(/감정적 압박 탐지 영역/)).not.toBeInTheDocument();
  const rects = container.querySelectorAll("rect");
  expect(rects).toHaveLength(2);
  expect(Number(rects[0]!.getAttribute("x"))).toBeCloseTo((24 / 390) * 100);
  expect(Number(rects[0]!.getAttribute("y"))).toBeCloseTo((520 / 844) * 100);
  expect(rects[1]).toHaveAttribute("stroke-dasharray", "5 3");
});

it("supports normalized coordinates without image metadata", () => {
  const finding = structuredClone(audit.findings[0]!);
  finding.bbox = {
    screenId: "screen-option",
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    coordinateSystem: "normalized",
  };
  const { container } = render(
    <ReportScreen
      screen={{ ...audit.screens[1]!, width: null, height: null }}
      findings={[{ finding, number: 1 }]}
    />,
  );
  const rect = container.querySelector("rect");
  expect(rect).toHaveAttribute("x", "10");
  expect(rect).toHaveAttribute("y", "20");
  expect(Number(rect!.getAttribute("width"))).toBeCloseTo(30);
  expect(Number(rect!.getAttribute("height"))).toBeCloseTo(40);
});

it("uses loaded image dimensions for pixel coordinates and does not invent missing locations", () => {
  const { container } = render(
    <ReportScreen
      screen={{ ...audit.screens[1]!, width: null, height: null }}
      findings={[
        { finding: audit.findings[0]!, number: 1 },
        { finding: { ...audit.findings[1]!, bbox: null }, number: 2 },
      ]}
    />,
  );
  expect(container.querySelector("rect")).toBeNull();
  const image = screen.getByRole("img");
  Object.defineProperties(image, { naturalWidth: { value: 390 }, naturalHeight: { value: 844 } });
  fireEvent.load(image);
  expect(container.querySelectorAll("rect")).toHaveLength(1);
  expect(Number(container.querySelector("rect")!.getAttribute("width"))).toBeCloseTo(
    (342 / 390) * 100,
  );
  expect(screen.getByText(/2. 감정적 압박: 위치 좌표가 없어/)).toBeInTheDocument();
});
