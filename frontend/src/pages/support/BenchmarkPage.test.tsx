import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";
import { BenchmarkPage } from "./BenchmarkPage";

function setup(versions = [1, 2], status: "completed" | "failed" = "completed") {
  const fixture = structuredClone(dashboardFixture);
  const audit = fixture.audits[0]!;
  audit.status = status;
  audit.runs = versions.map((version) => ({
    id: `run-${version}`,
    version,
    status: "completed",
    createdAt: audit.updatedAt,
    findingCount: 1,
  }));
  if (status === "failed")
    audit.runs.push({
      id: "run-9",
      version: 9,
      status: "failed",
      createdAt: audit.updatedAt,
      findingCount: 0,
    });
  server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/app/benchmark?audit=${audit.id}`]}>
        <BenchmarkPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return audit;
}

const response = {
  auditId: "audit-insurance-v1",
  fromVersion: 1,
  toVersion: 2,
  comparisonStatus: "complete",
  limitations: [],
  resolvedRatio: 0.5,
  resolved: [{ ruleId: "DA-04", findingId: "old-finding", before: "HIGH", after: null }],
  persisted: [
    { ruleId: "DA-12", findingId: "finding-emotional-pressure", before: "REVIEW", after: "REVIEW" },
  ],
  improved: [],
  new: [],
  regressed: [],
  pending: [],
};

it("shows the comparison and links only findings available in the current result", async () => {
  server.use(http.get("*/api/v1/audits/:auditId/regression", () => HttpResponse.json(response)));
  setup();
  expect(await screen.findByText("50%")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "해결 1건" })).toBeInTheDocument();
  expect(screen.getByText("원본 위치에서 문제가 사라짐")).toBeInTheDocument();
  expect(screen.getByText("위험 높음 → 해결")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "남은 항목 1건" })).toBeInTheDocument();
  expect(screen.getByText("신규 0건")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "검토하기" })).toHaveLength(1);
  expect(screen.queryByText(/미탐지/)).not.toBeInTheDocument();
});

it("compares the original with the latest run by default and shows deferred items", async () => {
  let query = "";
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", ({ request }) => {
      query = new URL(request.url).search;
      return HttpResponse.json({
        ...response,
        fromVersion: 1,
        toVersion: 7,
        comparisonStatus: "incomplete",
        limitations: ["검사 근거 부족"],
        resolvedRatio: null,
        resolved: [],
        pending: response.resolved,
      });
    }),
  );
  setup([1, 3, 7], "failed");
  expect(await screen.findByText("산출 보류")).toBeInTheDocument();
  expect(screen.getByText("검사 근거 부족")).toBeInTheDocument();
  expect(screen.getByText("보류")).toBeInTheDocument();
  expect(query).toBe("?from_version=1&to_version=7");
  expect(screen.getByRole("combobox", { name: "비교 기준" })).toHaveValue("1");
  expect(screen.getByRole("combobox", { name: "비교 대상" })).toHaveValue("7");
});

it("lets the reviewer pick both ends of the comparison", async () => {
  const queries: string[] = [];
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", ({ request }) => {
      queries.push(new URL(request.url).search);
      return HttpResponse.json(response);
    }),
  );
  setup([1, 2, 3]);
  await screen.findByText("50%");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "비교 대상" }), "2");
  await screen.findByRole("heading", { name: /→ v2 수정본 비교/ });
  expect(queries.at(-1)).toBe("?from_version=1&to_version=2");
});

it("shows a separate state when neither run has findings", async () => {
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", () =>
      HttpResponse.json({
        ...response,
        comparisonStatus: "empty",
        resolvedRatio: null,
        resolved: [],
        persisted: [],
      }),
    ),
  );
  setup();
  expect(await screen.findByRole("heading", { name: "비교할 항목 없음" })).toBeInTheDocument();
  expect(screen.getAllByText("비교할 항목 없음")).toHaveLength(2);
});

it("does not request comparison when only one completed run exists", async () => {
  let calls = 0;
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", () => {
      calls++;
      return HttpResponse.json(response);
    }),
  );
  setup([1]);
  expect(
    await screen.findByRole("heading", { name: "비교할 완료 회차가 부족합니다" }),
  ).toBeInTheDocument();
  expect(calls).toBe(0);
});

it("distinguishes verified resolutions from rules still awaiting evidence", async () => {
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", () =>
      HttpResponse.json({
        ...response,
        comparisonStatus: "incomplete",
        resolvedRatio: null,
        limitations: ["화면 간 가격 비교 제한"],
        scopeDescription: "각 데모 단계에 처음 진입한 6개 화면끼리 비교합니다.",
        pending: [
          {
            ruleId: "DA-15",
            findingId: "price-before",
            before: "HIGH",
            after: null,
            location: "6단계 최종 금액",
            element: "최종 이용료",
            verificationNote: "v2: 초기 가격을 확인하지 못했습니다.",
          },
        ],
      }),
    ),
  );
  setup();
  expect(await screen.findByText("일부 항목의 해결 판정이 보류되었습니다")).toBeInTheDocument();
  expect(screen.getByText(/검사 근거가 확인된 1건은 해결/)).toBeInTheDocument();
  expect(screen.getByText("산출 보류")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "해결 1건" })).toBeInTheDocument();
  expect(screen.getByText("1 → 1건")).toBeInTheDocument();
  expect(
    screen.getByText("각 데모 단계에 처음 진입한 6개 화면끼리 비교합니다."),
  ).toBeInTheDocument();
  expect(screen.getByText("6단계 최종 금액 · 최종 이용료")).toBeInTheDocument();
  expect(screen.getByText("확인 필요: v2: 초기 가격을 확인하지 못했습니다.")).toBeInTheDocument();
});

it("shows the ratio of verified items and how many pending items it excludes", async () => {
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", () =>
      HttpResponse.json({
        ...response,
        comparisonStatus: "incomplete",
        resolvedRatio: 0.5,
        limitations: [
          "v2: DA-07 판정 일부가 근거 기준을 충족하지 못해 해당 규칙의 해결 여부만 보류합니다.",
        ],
        pending: [{ ruleId: "DA-07", findingId: "terms-before", before: "HIGH", after: null }],
      }),
    ),
  );
  setup();
  expect(await screen.findByText("50%")).toBeInTheDocument();
  expect(screen.getByText("보류 1건 제외")).toBeInTheDocument();
  expect(screen.getByText(/해결률은 보류 1건을 제외하고 계산했습니다/)).toBeInTheDocument();
  expect(screen.queryByText("산출 보류")).not.toBeInTheDocument();
});

it("allows retry after a comparison error", async () => {
  let calls = 0;
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", () => {
      calls++;
      return calls === 1
        ? HttpResponse.json({ detail: "일시적 오류" }, { status: 500 })
        : HttpResponse.json(response);
    }),
  );
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("일시적 오류");
  await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(await screen.findByText("50%")).toBeInTheDocument();
});

it("opens the comparison in the same print preview as the audit report", async () => {
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
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", () =>
      HttpResponse.json({
        ...response,
        screenChanges: [
          { screenId: "screen-option", beforeCount: 1, afterCount: 0, status: "resolved" },
        ],
      }),
    ),
    http.get("*/api/v1/audits/:auditId/runs/:version", () =>
      HttpResponse.json(dashboardFixture.audits[0]),
    ),
  );
  setup();
  const button = await screen.findByRole("button", { name: "PDF 보고서 출력" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  const preview = within(screen.getByRole("dialog", { name: "PDF 보고서 미리보기" }));
  expect(preview.getByRole("heading", { name: "전후 비교 보고서" })).toBeInTheDocument();
  expect(preview.getByRole("button", { name: "인쇄 / PDF 저장" })).toBeInTheDocument();
  expect(preview.getByRole("heading", { name: "03. 해결 항목 1건" })).toBeInTheDocument();
  expect(preview.getByRole("heading", { name: "04. 남은 항목 1건" })).toBeInTheDocument();
  expect(preview.getByText("1 → 0 · 해결")).toBeInTheDocument();
});
