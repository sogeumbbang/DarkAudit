import { render, screen } from "@testing-library/react";

import type { AnalysisSummary } from "@/entities/audit/types";
import { AnalysisNotice } from "./AnalysisNotice";

const summary: AnalysisSummary = {
  complete: true,
  supportedRules: ["DA-03", "DA-04", "DA-07", "DA-12", "DA-15"],
  unsupportedRules: ["DA-01", "DA-02"],
  analyzedScreenCount: 6,
};
const zeroWarning = /탐지 0건이 전체 화면과 규칙에 문제가 없다는 뜻은 아닙니다/;

it("warns that zero detections do not mean no problems", () => {
  render(<AnalysisNotice summary={summary} findingCount={0} />);
  expect(screen.getByText(zeroWarning)).toBeInTheDocument();
});

it("drops only the zero-detection warning when findings exist", () => {
  render(<AnalysisNotice summary={summary} findingCount={11} />);
  expect(screen.queryByText(zeroWarning)).not.toBeInTheDocument();
  expect(screen.getByText("수집한 화면의 지원 규칙 검사 완료")).toBeInTheDocument();
  expect(screen.getByText(/지원 규칙 5개 · 분석 화면 6/)).toBeInTheDocument();
  expect(screen.getByText("미지원 규칙 2개: DA-01, DA-02")).toBeInTheDocument();
});
