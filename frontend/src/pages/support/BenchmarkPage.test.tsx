import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
  expect(await screen.findByText("해결률 · 50%")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "해결 · 1건" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "유지 · 1건" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "현재 항목 검토" })).toHaveLength(1);
});

it("shows null resolution as deferred and uses the last two completed runs", async () => {
  let query = "";
  server.use(
    http.get("*/api/v1/audits/:auditId/regression", ({ request }) => {
      query = new URL(request.url).search;
      return HttpResponse.json({
        ...response,
        fromVersion: 3,
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
  expect(await screen.findByText("해결률 · 산출 보류")).toBeInTheDocument();
  expect(screen.queryByText("해결률 · 0%")).not.toBeInTheDocument();
  expect(screen.getByText("검사 근거 부족")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "보류 · 1건" })).toBeInTheDocument();
  expect(query).toBe("?from=3&to=7");
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
  expect(screen.getByText("해결률 · 산출 보류")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "해결 · 1건" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "보류 · 1건" })).toBeInTheDocument();
  expect(screen.getByText("탐지 항목 1건 → 1건")).toBeInTheDocument();
  expect(
    screen.getByText("각 데모 단계에 처음 진입한 6개 화면끼리 비교합니다."),
  ).toBeInTheDocument();
  expect(screen.getByText("6단계 최종 금액 · 최종 이용료")).toBeInTheDocument();
  expect(screen.getByText("확인 필요: v2: 초기 가격을 확인하지 못했습니다.")).toBeInTheDocument();
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
  expect(await screen.findByText("해결률 · 50%")).toBeInTheDocument();
});
