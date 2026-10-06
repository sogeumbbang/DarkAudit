import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";

import * as auditApi from "@/api/audits";
import type { AuditDto } from "@/entities/audit/types";
import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";
import { DemoRecheckPanel } from "./DemoRecheckPanel";

function setup(
  source: "screenshots" | "website" | "figma" | "android" = "screenshots",
  overrides: Partial<AuditDto> = {},
) {
  const audit = structuredClone(dashboardFixture.audits[0]!);
  audit.status = "completed";
  audit.demoPreset = { scenario: "pet", source };
  audit.demoVariant = "risky";
  Object.assign(audit, overrides);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <DemoRecheckPanel audit={audit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return audit;
}

it("runs a fixed revised screenshot demo on the original audit and preserves retry uploads", async () => {
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
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "내 파일로 재검사" })).not.toBeInTheDocument();
  const button = screen.getByRole("button", { name: "수정본 검사 시작" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("분석 접수 실패");
  await user.click(button);
  await screen.findByRole("heading", { name: "수정본 검사가 완료되었습니다" });
  expect(uploads).toBe(1);
  expect(metadata).toHaveLength(6);
  expect(metadata.every((item) => item.demoVariant === "revised")).toBe(true);
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
  const button = screen.getByRole("button", { name: "수정본 검사 시작" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await screen.findByRole("heading", { name: "수정본 검사가 완료되었습니다" });
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
  const button = screen.getByRole("button", { name: "수정본 검사 시작" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("올바르지 않습니다");
  expect(uploads).toBe(0);
});

it.each(["figma", "android"] as const)(
  "rechecks the fixed revised %s input on the same audit",
  async (source) => {
    const versions: string[] = [];
    const assets: string[] = [];
    server.use(
      http.post(
        `*/api/v1/audits/:id/${source === "figma" ? "figma" : "mobile-app"}`,
        async ({ params, request }) => {
          expect(params.id).toBe(audit.id);
          if (source === "figma") {
            const input = (await request.json()) as {
              demoVariant: string;
              flowName: string;
              selectionMode: string;
            };
            expect(input.selectionMode).toBe("prototype-flow");
            expect(input.flowName).toContain(input.demoVariant);
            versions.push(input.demoVariant);
          } else {
            const input = await request.formData();
            versions.push(String(input.get("demo_variant")));
            expect(input.get("app")).toBeInstanceOf(File);
          }
          return HttpResponse.json({
            jobId: "native-demo",
            auditId: audit.id,
            status: "queued",
            progress: 5,
          });
        },
      ),
      http.get("*/demo/android/:file", ({ params }) => {
        assets.push(String(params.file));
        return new HttpResponse(new Uint8Array([0x50, 0x4b, 3, 4]).buffer);
      }),
      http.get("*/api/v1/analysis-jobs/native-demo", () =>
        HttpResponse.json({
          jobId: "native-demo",
          auditId: audit.id,
          status: "completed",
          progress: 100,
        }),
      ),
    );
    const androidSpy =
      source === "android"
        ? vi.spyOn(auditApi, "analyzeAndroidApp").mockImplementation(async (input) => {
            expect(input.auditId).toBe(audit.id);
            expect(input.appFile.size).toBe(4);
            versions.push(input.demoVariant!);
            return { jobId: "native-demo", auditId: audit.id, status: "queued", progress: 5 };
          })
        : undefined;
    const audit = setup(source);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "수정본 검사 시작" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await screen.findByRole("heading", { name: "수정본 검사가 완료되었습니다" });
    androidSpy?.mockRestore();
    expect(versions).toEqual(["revised"]);
    if (source === "android") expect(assets).toEqual(["revised.apk"]);
  },
);

it("warns and asks before saving another revision when one already exists", async () => {
  let uploads = 0;
  server.use(
    http.post("*/api/v1/audits/:id/screens", () => {
      uploads++;
      return HttpResponse.json(audit);
    }),
    http.post("*/api/v1/audits/:id/analyze", () =>
      HttpResponse.json({ jobId: "third", auditId: audit.id, status: "queued", progress: 5 }),
    ),
    http.get("*/api/v1/analysis-jobs/third", () =>
      HttpResponse.json({ jobId: "third", auditId: audit.id, status: "completed", progress: 100 }),
    ),
  );
  const audit = setup("screenshots", {
    demoVariant: "revised",
    runs: [
      [1, 7],
      [2, 1],
    ].map(([version, findingCount]) => ({
      id: `run-${version}`,
      version: version!,
      status: "completed" as const,
      createdAt: "2026-10-05T00:00:00Z",
      findingCount: findingCount!,
    })),
  });
  const user = userEvent.setup();
  expect(screen.getByRole("note")).toHaveTextContent(
    "이미 v2 결과가 있는 진단입니다. 다시 실행하면 v3로 저장되고, 전후 비교는 계속 v1 원본을 기준으로 합니다.",
  );
  const button = screen.getByRole("button", { name: "새 수정본으로 다시 검사" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(screen.getByRole("alertdialog", { name: "v3로 다시 검사할까요?" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "취소" }));
  expect(uploads).toBe(0);
  await user.click(button);
  await user.click(screen.getByRole("button", { name: "다시 검사" }));
  await screen.findByRole("heading", { name: "수정본 검사가 완료되었습니다" });
  expect(uploads).toBe(1);
});
