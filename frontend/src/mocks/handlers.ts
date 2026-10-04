import { bypass, delay, http, HttpResponse } from "msw";
import demoCatalog from "./fixtures/demo-cases.json";

import { chatbotHandlers } from "@/features/chatbot/mocks";
import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import type {
  AnalysisJobDto,
  AuditDto,
  CreateAuditDto,
  FindingStatus,
  ImportFigmaAuditDto,
  DemoVariant,
} from "@/entities/audit/types";

const jobs = new Map<string, AnalysisJobDto>();

function addMockRun(audit: AuditDto) {
  if (!audit.runs?.length && audit.status === "completed") {
    audit.runs = [
      {
        id: `${audit.id}-run-1`,
        version: 1,
        status: "completed",
        createdAt: audit.updatedAt,
        findingCount: audit.findings.length,
      },
    ];
  }
  const version = Math.max(0, ...(audit.runs ?? []).map((run) => run.version)) + 1;
  const run = {
    id: `${audit.id}-run-${version}`,
    version,
    status: "queued" as const,
    createdAt: new Date().toISOString(),
    findingCount: 0,
  };
  audit.runs = [...(audit.runs ?? []), run];
  audit.status = "queued";
  audit.updatedAt = run.createdAt;
  return run;
}

export const handlers = [
  ...chatbotHandlers,
  http.put("*/api/v1/findings/:findingId/decision", async ({ params, request }) => {
    const { decisionNote } = (await request.json()) as { decisionNote: string };
    if (typeof decisionNote !== "string" || decisionNote.length > 4000) {
      return HttpResponse.json({ detail: "Invalid decision note" }, { status: 422 });
    }
    const finding = dashboardFixture.audits
      .flatMap((audit) => audit.findings)
      .find((item) => item.id === params.findingId);
    if (!finding) return HttpResponse.json({ detail: "Finding not found" }, { status: 404 });
    finding.decisionNote = decisionNote.trim();
    finding.decisionUpdatedAt = new Date().toISOString();
    const audit = dashboardFixture.audits.find((item) => item.findings.includes(finding));
    if (audit) audit.updatedAt = finding.decisionUpdatedAt;
    return HttpResponse.json({
      id: finding.id,
      decisionNote: finding.decisionNote,
      decisionUpdatedAt: finding.decisionUpdatedAt,
    });
  }),
  http.get("*/health", () => HttpResponse.json({ status: "ok" })),
  http.get("*/api/v1/demo-inputs", () => {
    return HttpResponse.json({
      cases: demoCatalog.cases,
      website: { url: "/demo/web/index.html?step=1", available: true },
      figma: {
        fileUrl: "https://www.figma.com/design/demo-file/Banking-Demo",
        available: true,
        reason: null,
      },
      android: { downloadUrl: "/demo/darkaudit-demo.apk", available: true, reason: null },
    });
  }),
  http.get("*/demo/cases/:scenario/:variant/:filename", ({ params, request }) => {
    if (import.meta.env.MODE === "test")
      return new HttpResponse(
        Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          ),
          (char) => char.charCodeAt(0),
        ),
        { headers: { "Content-Type": "image/png" } },
      );
    return fetch(
      bypass(
        new URL(`/demo-cases/${params.scenario}/${params.variant}/${params.filename}`, request.url),
      ),
    );
  }),
  http.get(
    "*/demo/darkaudit-demo.apk",
    () =>
      new HttpResponse(new Uint8Array([0x50, 0x4b, 3, 4]).buffer, {
        headers: { "Content-Type": "application/vnd.android.package-archive" },
      }),
  ),
  http.get("*/api/v1/dashboard/summary", async () => {
    await delay(350);
    return HttpResponse.json(dashboardFixture);
  }),
  http.post("*/api/v1/audits", async ({ request }) => {
    const input = (await request.json()) as CreateAuditDto;
    const auditId = `audit-${crypto.randomUUID()}`;
    const audit = {
      id: auditId,
      name: input.name,
      platform: input.platform,
      productType: input.productType ?? null,
      demoPreset: input.demoPreset,
      createdAt: new Date().toISOString(),
      status: "draft" as const,
      updatedAt: new Date().toISOString(),
      screens: [],
      findings: [],
    };
    dashboardFixture.audits.unshift(audit);
    return HttpResponse.json(audit, { status: 201 });
  }),
  http.post("*/api/v1/audits/:auditId/screens", async ({ params, request }) => {
    const audit = dashboardFixture.audits.find((item) => item.id === params.auditId);
    if (!audit) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
    addMockRun(audit);
    const encodedMetadata = request.headers.get("X-DarkAudit-Screen-Metadata") ?? "%5B%5D";
    const metadata = JSON.parse(decodeURIComponent(encodedMetadata)) as Array<{
      id: string;
      flowStep: string;
      fileName: string;
      demoVariant?: DemoVariant;
    }>;
    audit.demoVariant = metadata[0]?.demoVariant ?? null;
    audit.screens = metadata.map((screen, index) => ({
      id: screen.id,
      order: index + 1,
      flowStep: screen.flowStep,
      imageUrl:
        audit.demoPreset && audit.demoVariant
          ? `/demo-cases/${audit.demoPreset.scenario}/${audit.demoVariant}/${String(index + 1).padStart(2, "0")}.png`
          : screen.fileName.match(/^0[1-6]-/)
            ? `/sample-audit/${screen.fileName}`
            : `/mock/${screen.fileName}`,
      findingCount: 0,
    }));
    return HttpResponse.json(audit);
  }),
  http.post("*/api/v1/audits/:auditId/analyze", async ({ params }) => {
    const auditId = String(params.auditId);
    const job: AnalysisJobDto = {
      jobId: `job-${crypto.randomUUID()}`,
      auditId,
      status: "queued",
      progress: 5,
    };
    jobs.set(job.jobId, job);
    const audit = dashboardFixture.audits.find((item) => item.id === auditId);
    if (audit) {
      audit.status = "queued";
      job.runId = audit.runs?.at(-1)?.id;
    }
    return HttpResponse.json(job, { status: 202 });
  }),
  http.post("*/api/v1/audits/:auditId/capture", async ({ params, request }) => {
    const auditId = String(params.auditId);
    const input = (await request.json()) as {
      url: string;
      mode: "quick" | "smart";
      profiles: Array<"desktop" | "mobile">;
      demoVariant?: DemoVariant;
    };
    const audit = dashboardFixture.audits.find((item) => item.id === auditId);
    if (!audit) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
    const run = addMockRun(audit);
    audit.demoVariant = input.demoVariant;
    audit.screens = input.profiles.map((profile, index) => ({
      id: `screen-${index + 1}`,
      order: index + 1,
      flowStep: `${profile}: initial viewport`,
      imageUrl: `/mock/${profile}.png`,
      findingCount: 0,
    }));
    const job: AnalysisJobDto = {
      jobId: `job-${crypto.randomUUID()}`,
      auditId,
      runId: run.id,
      status: "queued",
      progress: 5,
    };
    jobs.set(job.jobId, job);
    audit.status = "queued";
    return HttpResponse.json(job, { status: 202 });
  }),
  http.post("*/api/v1/audits/:auditId/figma", async ({ params, request }) => {
    const auditId = String(params.auditId);
    const input = (await request.json()) as Omit<ImportFigmaAuditDto, "auditId">;
    const audit = dashboardFixture.audits.find((item) => item.id === auditId);
    if (!audit) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
    audit.screens = ["시작 프레임", "옵션 선택", "최종 확인"].map((flowStep, index) => ({
      id: `figma-${index + 1}`,
      order: index + 1,
      flowStep,
      imageUrl: `/mock/figma-frame-${index + 1}.png`,
      findingCount: 0,
    }));
    audit.platform = input.target;
    const job: AnalysisJobDto = {
      jobId: `job-${crypto.randomUUID()}`,
      auditId,
      runId: `run-${crypto.randomUUID()}`,
      status: "queued",
      progress: 5,
    };
    jobs.set(job.jobId, job);
    audit.status = "queued";
    return HttpResponse.json(job, { status: 202 });
  }),
  http.post("*/api/v1/audits/:auditId/mobile-app", async ({ params }) => {
    const auditId = String(params.auditId);
    const audit = dashboardFixture.audits.find((item) => item.id === auditId);
    if (!audit) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
    audit.platform = "app";
    audit.screens = ["앱 시작", "주요 선택", "확인 직전"].map((flowStep, index) => ({
      id: `android-${index + 1}`,
      order: index + 1,
      flowStep,
      imageUrl: `/mock/android-${index + 1}.png`,
      findingCount: 0,
    }));
    const job: AnalysisJobDto = {
      jobId: `job-${crypto.randomUUID()}`,
      auditId,
      runId: `run-${crypto.randomUUID()}`,
      status: "queued",
      progress: 5,
    };
    jobs.set(job.jobId, job);
    audit.status = "queued";
    return HttpResponse.json(job, { status: 202 });
  }),
  http.get("*/api/v1/analysis-jobs/:jobId", async ({ params }) => {
    await delay(250);
    const job = jobs.get(String(params.jobId));
    if (!job) return HttpResponse.json({ message: "Job not found" }, { status: 404 });
    job.progress = Math.min(100, job.progress + 24);
    job.status = job.progress >= 100 ? "completed" : "analyzing";
    const audit = dashboardFixture.audits.find((item) => item.id === job.auditId);
    if (audit) {
      audit.status = job.status === "completed" ? "completed" : "analyzing";
      audit.updatedAt = new Date().toISOString();
      const run = audit.runs?.find((item) => item.id === job.runId);
      if (run) {
        run.status = audit.status;
        run.findingCount = audit.findings.length;
        if (run.status === "completed") audit.latestRunId = run.id;
      }
    }
    return HttpResponse.json(job);
  }),
  http.delete("*/api/v1/audits/:auditId", async ({ params }) => {
    const index = dashboardFixture.audits.findIndex((audit) => audit.id === params.auditId);
    if (index < 0) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
    dashboardFixture.audits.splice(index, 1);
    if (dashboardFixture.activeAuditId === params.auditId) {
      dashboardFixture.activeAuditId = dashboardFixture.audits[0]?.id ?? null;
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.patch("*/api/v1/findings/:findingId", async ({ params, request }) => {
    const { status } = (await request.json()) as { status: FindingStatus };
    const finding = dashboardFixture.audits
      .flatMap((audit) => audit.findings)
      .find((item) => item.id === params.findingId);
    if (!finding) return HttpResponse.json({ message: "Finding not found" }, { status: 404 });
    finding.status = status;
    const audit = dashboardFixture.audits.find((item) => item.findings.includes(finding));
    if (audit) audit.updatedAt = new Date().toISOString();
    return HttpResponse.json({ id: finding.id, status });
  }),
  http.get("*/api/v1/audits/:auditId/regression", ({ params, request }) => {
    const audit = dashboardFixture.audits.find((item) => item.id === params.auditId);
    if (!audit) return HttpResponse.json({ detail: "Audit not found" }, { status: 404 });
    const completed = (audit.runs ?? []).filter((run) => run.status === "completed");
    if (completed.length < 2)
      return HttpResponse.json({ detail: "비교할 이전 회차가 없습니다." }, { status: 409 });
    const query = new URL(request.url).searchParams;
    return HttpResponse.json({
      auditId: audit.id,
      fromVersion: Number(query.get("from") ?? completed.at(-2)!.version),
      toVersion: Number(query.get("to") ?? completed.at(-1)!.version),
      comparisonStatus: "incomplete",
      limitations: ["모의 분석 결과이므로 실제 해결 여부를 확인할 수 없습니다."],
      resolvedRatio: null,
      resolved: [],
      improved: [],
      new: [],
      regressed: [],
      pending: [],
      persisted: audit.findings.map((finding) => ({
        ruleId: finding.ruleId,
        findingId: finding.id,
        before: finding.severity,
        after: finding.severity,
      })),
    });
  }),
];
