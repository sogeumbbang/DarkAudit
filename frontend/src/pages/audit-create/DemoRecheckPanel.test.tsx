import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";
import { DemoRecheckPanel } from "./DemoRecheckPanel";

function setup(source: "screenshots" | "website" = "screenshots") {
  const audit = structuredClone(dashboardFixture.audits[0]!);
  audit.status = "completed";
  audit.demoPreset = { scenario: "pet", source };
  audit.demoVariant = "risky";
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <DemoRecheckPanel audit={audit} manualForm={<p>Manual form</p>} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return audit;
}

it("runs a partial screenshot demo on the original audit and preserves retry uploads", async () => {
  let uploads = 0;
  let starts = 0;
  let metadata: Array<{ flowStep: string; demoVariant: string }> = [];
  server.use(
    http.post("*/api/v1/audits/:id/screens", ({ params, request }) => {
      expect(params.id).toBe(audit.id);
      uploads++;
      metadata = JSON.parse(
        decodeURIComponent(request.headers.get("X-DarkAudit-Screen-Metadata")!),
      );
      return HttpResponse.json(audit);
    }),
    http.post("*/api/v1/audits/:id/analyze", () => {
      starts++;
      return starts === 1
        ? HttpResponse.json({ detail: "분석 접수 실패" }, { status: 503 })
        : HttpResponse.json({
            jobId: "demo-update",
            auditId: audit.id,
            status: "queued",
            progress: 5,
          });
    }),
    http.get("*/api/v1/analysis-jobs/demo-update", () =>
      HttpResponse.json({
        jobId: "demo-update",
        auditId: audit.id,
        status: "completed",
        progress: 100,
      }),
    ),
  );
  const audit = setup();
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "선택한 데모 수정본 실행" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("분석 접수 실패");
  await user.click(button);
  await screen.findByRole("heading", { name: "데모 수정본 분석이 완료되었습니다" });
  expect(uploads).toBe(1);
  expect(metadata).toHaveLength(6);
  expect(metadata.every((item) => item.demoVariant === "partial")).toBe(true);
  expect(metadata[0]!.flowStep).toBe("보장 소개");
});

it("uses the revised public URL and the same audit for URL demos", async () => {
  let input: Record<string, unknown> | undefined;
  server.use(
    http.post("*/api/v1/audits/:id/capture", async ({ request, params }) => {
      expect(params.id).toBe(audit.id);
      input = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        jobId: "demo-url",
        auditId: audit.id,
        status: "queued",
        progress: 5,
      });
    }),
    http.get("*/api/v1/analysis-jobs/demo-url", () =>
      HttpResponse.json({
        jobId: "demo-url",
        auditId: audit.id,
        status: "completed",
        progress: 100,
      }),
    ),
  );
  const audit = setup("website");
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("실행할 수정본"), "revised");
  const button = screen.getByRole("button", { name: "선택한 데모 수정본 실행" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await screen.findByRole("heading", { name: "데모 수정본 분석이 완료되었습니다" });
  expect(input).toMatchObject({ mode: "smart", profiles: ["mobile"], demoVariant: "revised" });
  expect(input!.url).toContain("scenario=pet&variant=revised&step=1");
});

it("does not create a run when downloading a revised image fails", async () => {
  let uploads = 0;
  server.use(
    http.get("*/demo/cases/:scenario/:variant/:file", () => HttpResponse.html("not an image")),
    http.post("*/api/v1/audits/:id/screens", () => {
      uploads++;
      return HttpResponse.json({});
    }),
  );
  setup();
  const button = screen.getByRole("button", { name: "선택한 데모 수정본 실행" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("올바르지 않습니다");
  expect(uploads).toBe(0);
});
