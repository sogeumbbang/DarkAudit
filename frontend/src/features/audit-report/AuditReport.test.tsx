import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { AuditReport } from "./AuditReport";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(window, "print").mockImplementation(() => {});
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => vi.restoreAllMocks());

it("includes all findings, saved decisions and incomplete analysis in the report", () => {
  const audit = structuredClone(dashboardFixture.audits[0]!);
  audit.findings[0]!.decisionNote = "기본 선택을 해제하기로 결정했습니다.";
  audit.analysisSummary = {
    complete: false,
    limitations: ["최종 결제 화면 누락"],
    ruleAssessments: [
      { ruleId: "DA-15", status: "insufficient_evidence", reasons: ["가격 확인 불가"] },
    ],
  };
  render(<AuditReport audit={audit} onClose={vi.fn()} />);
  for (const finding of audit.findings) {
    expect(screen.getByRole("heading", { name: new RegExp(finding.title) })).toBeInTheDocument();
    expect(screen.getByText(finding.recommendation, { exact: false })).toBeInTheDocument();
  }
  expect(screen.getByText(/기본 선택을 해제하기로 결정했습니다/)).toBeInTheDocument();
  expect(screen.getByText("최종 결제 화면 누락")).toBeInTheDocument();
  expect(screen.getByText(/DA-15: 근거 부족/)).toBeInTheDocument();
  expect(screen.getAllByRole("img")).toHaveLength(audit.screens.length);
});

it("waits for images, prints with the audit title and restores the document title", async () => {
  const user = userEvent.setup();
  const previousTitle = document.title;
  let finish!: () => void;
  vi.mocked(HTMLImageElement.prototype.decode).mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(window.print).mockImplementation(() => {
    expect(document.title).toContain(dashboardFixture.audits[0]!.name);
  });
  render(<AuditReport audit={dashboardFixture.audits[0]!} onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "인쇄 / PDF 저장" }));
  expect(window.print).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "인쇄 준비 중…" })).toBeDisabled();
  finish();
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(document.title).toBe(previousTitle);
});

it("reports failed image loading without printing an incomplete report", async () => {
  vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValue(new Error("missing image"));
  render(<AuditReport audit={dashboardFixture.audits[0]!} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "인쇄 / PDF 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("다시 시도해주세요");
  expect(window.print).not.toHaveBeenCalled();
});

it("does not mistake an empty result for complete coverage", () => {
  const audit = { ...dashboardFixture.audits[0]!, findings: [], analysisSummary: undefined };
  render(<AuditReport audit={audit} onClose={vi.fn()} />);
  expect(screen.getByText(/탐지된 항목이 없습니다. 분석 범위/)).toBeInTheDocument();
  expect(screen.getByText(/분석 완료 여부를 확인/)).toBeInTheDocument();
});
