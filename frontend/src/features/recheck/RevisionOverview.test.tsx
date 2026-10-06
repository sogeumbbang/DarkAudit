import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router-dom";

import type { AuditDto } from "@/entities/audit/types";
import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";
import { OverviewPage } from "@/pages/overview/OverviewPage";

// v1 original: every fixture finding. v2 revision: one new finding on the consent screen.
function setup(path: string) {
  const fixture = structuredClone(dashboardFixture);
  const original = fixture.audits[0]!;
  original.name = "스크린샷 데모 · 모루 반려동물 보험 · 문제 포함 원본";
  original.runs = [
    {
      id: "run-1",
      version: 1,
      status: "completed",
      createdAt: original.updatedAt,
      findingCount: 3,
      variant: "risky",
    },
    {
      id: "run-2",
      version: 2,
      status: "completed",
      createdAt: original.updatedAt,
      findingCount: 1,
      variant: "revised",
    },
  ];
  const revision: AuditDto = structuredClone(original);
  const kept = { ...revision.findings[1]!, id: "finding-new-consent" };
  revision.findings = [kept];
  server.use(
    http.get("*/api/v1/dashboard/summary", () =>
      HttpResponse.json({ ...fixture, audits: [revision, ...fixture.audits.slice(1)] }),
    ),
    http.get("*/api/v1/audits/:id/runs/1", () => HttpResponse.json(original)),
    http.get("*/api/v1/audits/:id/regression", () =>
      HttpResponse.json({
        auditId: original.id,
        fromVersion: 1,
        toVersion: 2,
        comparisonStatus: "complete",
        limitations: [],
        resolvedRatio: 1,
        resolved: original.findings.map((finding) => ({
          ruleId: finding.ruleId,
          findingId: `old-${finding.id}`,
          before: "HIGH",
          after: null,
        })),
        improved: [],
        persisted: [],
        new: [
          {
            ruleId: kept.ruleId,
            findingId: kept.id,
            before: null,
            after: "HIGH",
            location: "동의 화면",
          },
        ],
        regressed: [],
        pending: [],
        screenChanges: [
          { screenId: "screen-intro", beforeCount: 0, afterCount: 0, status: "clear" },
          { screenId: "screen-option", beforeCount: 2, afterCount: 0, status: "resolved" },
          { screenId: "screen-consent", beforeCount: 0, afterCount: 1, status: "new" },
        ],
      }),
    ),
  );
  function Location() {
    const location = useLocation();
    return <output data-testid="location">{location.search}</output>;
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <OverviewPage />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return original;
}

it("shows a revision against the original with changes per screen", async () => {
  const audit = setup("/app/overview?audit=audit-insurance-v1");
  expect(
    await screen.findByRole("heading", { name: "스크린샷 데모 · 모루 반려동물 보험" }),
  ).toBeInTheDocument();
  expect(screen.getByText("v2 수정본", { selector: ".rc-badge" })).toBeInTheDocument();
  const switcher = within(screen.getByRole("navigation", { name: "회차 전환" }));
  expect(switcher.getByRole("link", { name: "v1 원본 3건" })).toHaveAttribute(
    "href",
    `/app/overview?audit=${audit.id}&version=1`,
  );
  expect(switcher.getByRole("link", { name: "v2 수정본 1건" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const metrics = within(await screen.findByRole("region", { name: "원본 대비 결과" }));
  expect(metrics.getByText("3 → 1")).toBeInTheDocument();
  expect(metrics.getByText("원본 항목 전부")).toBeInTheDocument();
  expect(metrics.getByText(/DA-\d+ 신규$/)).toBeInTheDocument();

  const flow = within(screen.getByRole("group", { name: "가입 흐름 단계" }));
  expect(flow.getByText("2 → 0 · 해결")).toBeInTheDocument();
  expect(flow.getByText("0 → 1 · 신규")).toBeInTheDocument();

  // The screen that changed the most opens first, original and revision side by side.
  const preview = within(screen.getByRole("region", { name: "원본과 수정본 화면 비교" }));
  expect(preview.getByText("v1 원본 · 2건")).toBeInTheDocument();
  expect(preview.getByText("v2 수정본 · 해결 2")).toBeInTheDocument();

  const panel = within(screen.getByRole("complementary", { name: "원본 대비 변화" }));
  expect(panel.getByRole("heading", { name: "해결 3건" })).toBeInTheDocument();
  expect(panel.getByRole("link", { name: "전후 비교에서 자세히 보기" })).toHaveAttribute(
    "href",
    `/app/benchmark?audit=${audit.id}`,
  );
  await userEvent.click(panel.getByRole("button", { name: "검토하기" }));
  expect(screen.getByTestId("location")).toHaveTextContent("finding=finding-new-consent");
});

it("reopens the original run with its own findings", async () => {
  setup("/app/overview?audit=audit-insurance-v1&version=1");
  expect(await screen.findByText("v1 원본", { selector: ".rc-badge" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "진단 현황" })).toHaveTextContent("3건");
  expect(screen.queryByRole("region", { name: "원본 대비 결과" })).not.toBeInTheDocument();
});
