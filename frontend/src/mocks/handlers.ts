import { delay, http, HttpResponse } from "msw";

import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import type {
  AnalysisJobDto,
  CreateAuditDto,
  FindingStatus,
  ImportFigmaAuditDto,
} from "@/entities/audit/types";

const jobs = new Map<string, AnalysisJobDto>();

export const handlers = [
  http.post("*/api/v1/chat", async ({ request }) => {
    const { message } = (await request.json()) as { message: string };
    await delay(300);
    return HttpResponse.json({
      answer: `목업 응답입니다. "${message}"에 대한 가이드라인 근거를 확인하세요. [1]`,
      sources: [
        {
          index: 1,
          title: "온라인 금융상품 판매 관련 다크패턴 가이드라인 (별첨)",
          section: "오도형 > ④ 특정옵션의 사전선택",
          sourceFile: "251224[별첨] 온라인 금융상품 판매 관련 다크패턴 가이드라인.pdf",
          excerpt:
            "사업자에게 유리한 선택사항(옵션)을 미리 선택해놓고 금융소비자가 이를 지나치게 하거나 그대로 수용하도록 유도하는 행위",
        },
      ],
    });
  }),
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
    return HttpResponse.json({
      id: finding.id,
      decisionNote: finding.decisionNote,
      decisionUpdatedAt: finding.decisionUpdatedAt,
    });
  }),
  http.get("*/health", () => HttpResponse.json({ status: "ok" })),
  http.get("*/api/v1/demo-inputs", () => {
    return HttpResponse.json({
      website: { url: "/demo/web/index.html?step=1", available: true },
      figma: {
        fileUrl: "https://www.figma.com/design/demo-file/Banking-Demo",
        available: true,
        reason: null,
      },
      android: { downloadUrl: "/demo/darkaudit-demo.apk", available: true, reason: null },
    });
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
    const encodedMetadata = request.headers.get("X-DarkAudit-Screen-Metadata") ?? "%5B%5D";
    const metadata = JSON.parse(decodeURIComponent(encodedMetadata)) as Array<{
      id: string;
      flowStep: string;
      fileName: string;
    }>;
    audit.screens = metadata.map((screen, index) => ({
      id: screen.id,
      order: index + 1,
      flowStep: screen.flowStep,
      imageUrl: screen.fileName.match(/^0[1-5]-/)
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
    if (audit) audit.status = "queued";
    return HttpResponse.json(job, { status: 202 });
  }),
  http.post("*/api/v1/audits/:auditId/capture", async ({ params, request }) => {
    const auditId = String(params.auditId);
    const input = (await request.json()) as {
      url: string;
      mode: "quick" | "smart";
      profiles: Array<"desktop" | "mobile">;
    };
    const audit = dashboardFixture.audits.find((item) => item.id === auditId);
    if (!audit) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
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
      runId: `run-${crypto.randomUUID()}`,
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
    if (audit) audit.status = job.status === "completed" ? "completed" : "analyzing";
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
    return HttpResponse.json({ id: finding.id, status });
  }),
];
