import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";
import { AuditRecheckPage } from "./AuditRecheckPage";

function setup(status: "completed" | "analyzing" = "completed") {
  const fixture = structuredClone(dashboardFixture);
  const audit = fixture.audits[0]!;
  audit.status = status;
  audit.screens = audit.screens.slice(0, 2);
  server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/app/audits/${audit.id}/recheck`]}>
        <Routes>
          <Route path="/app/audits/:auditId/recheck" element={<AuditRecheckPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return audit;
}

async function chooseFiles() {
  const user = userEvent.setup();
  const inputs = await screen.findAllByLabelText(/수정본$/);
  for (let i = 0; i < inputs.length; i++) {
    await user.upload(inputs[i]!, new File(["png"], `replacement-${i}.png`, { type: "image/png" }));
  }
  return user;
}

it("reuses the audit and preserves screen order and labels without creating another audit", async () => {
  let metadata: Array<{ id: string; flowStep: string }> = [];
  let uploads = 0;
  let creations = 0;
  server.use(
    http.post("*/api/v1/audits", () => {
      creations++;
      return HttpResponse.json({}, { status: 500 });
    }),
    http.post("*/api/v1/audits/:auditId/screens", ({ request, params }) => {
      expect(params.auditId).toBe(audit.id);
      uploads++;
      metadata = JSON.parse(
        decodeURIComponent(request.headers.get("X-DarkAudit-Screen-Metadata")!),
      );
      return HttpResponse.json(audit);
    }),
    http.post("*/api/v1/audits/:auditId/analyze", () =>
      HttpResponse.json({ jobId: "recheck", auditId: audit.id, status: "queued", progress: 5 }),
    ),
    http.get("*/api/v1/analysis-jobs/recheck", () =>
      HttpResponse.json({
        jobId: "recheck",
        auditId: audit.id,
        status: "completed",
        progress: 100,
      }),
    ),
  );
  const audit = setup();
  const user = await chooseFiles();
  await user.dblClick(screen.getByRole("button", { name: "수정본 재검사 시작" }));
  expect(
    await screen.findByRole("heading", { name: "수정본 재검사가 완료되었습니다" }),
  ).toBeInTheDocument();
  expect(metadata.map(({ id, flowStep }) => ({ id, flowStep }))).toEqual(
    audit.screens.map(({ id, flowStep }) => ({ id, flowStep })),
  );
  expect(uploads).toBe(1);
  expect(creations).toBe(0);
  expect(screen.getByRole("link", { name: "전후 비교 보기" })).toHaveAttribute(
    "href",
    `/app/benchmark?audit=${audit.id}`,
  );
});

it("retries an analysis request failure without uploading another run", async () => {
  let uploads = 0;
  let starts = 0;
  server.use(
    http.post("*/api/v1/audits/:auditId/screens", () => {
      uploads++;
      return HttpResponse.json(audit);
    }),
    http.post("*/api/v1/audits/:auditId/analyze", () => {
      starts++;
      return starts === 1
        ? HttpResponse.json({ detail: "일시적 오류" }, { status: 503 })
        : HttpResponse.json({ jobId: "retry", auditId: audit.id, status: "queued", progress: 5 });
    }),
    http.get("*/api/v1/analysis-jobs/retry", () =>
      HttpResponse.json({ jobId: "retry", auditId: audit.id, status: "completed", progress: 100 }),
    ),
  );
  const audit = setup();
  const user = await chooseFiles();
  await user.click(screen.getByRole("button", { name: "수정본 재검사 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("일시적 오류");
  await user.click(screen.getByRole("button", { name: "분석 다시 시도" }));
  await screen.findByRole("heading", { name: "수정본 재검사가 완료되었습니다" });
  expect(uploads).toBe(1);
  expect(starts).toBe(2);
});

it("keeps selected files after upload failure and permits retry", async () => {
  server.use(
    http.post("*/api/v1/audits/:auditId/screens", () =>
      HttpResponse.json({ detail: "업로드 실패" }, { status: 500 }),
    ),
  );
  setup();
  const user = await chooseFiles();
  await user.click(screen.getByRole("button", { name: "수정본 재검사 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("업로드 실패");
  expect(screen.getByText("선택됨: replacement-0.png")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "수정본 재검사 시작" })).toBeEnabled();
});

it("requires every replacement and blocks a currently running audit", async () => {
  setup("analyzing");
  await screen.findByText("진행 중인 회차가 있습니다. 완료 후 다시 열어 주세요.");
  expect(screen.getByRole("button", { name: "수정본 재검사 시작" })).toBeDisabled();
  for (const input of screen.getAllByLabelText(/수정본$/)) expect(input).toBeDisabled();
});

it("rejects oversized files before starting a request", async () => {
  setup();
  const user = userEvent.setup();
  const inputs = await screen.findAllByLabelText(/수정본$/);
  const file = new File(["png"], "large.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
  await user.upload(inputs[0]!, file);
  expect(await screen.findByRole("alert")).toHaveTextContent("10 MiB 이하");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "수정본 재검사 시작" })).toBeDisabled(),
  );
});
