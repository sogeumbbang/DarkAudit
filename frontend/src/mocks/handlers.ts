import { bypass, delay, http, HttpResponse } from "msw";
import demoCatalog from "./fixtures/demo-cases.json";

import { chatbotHandlers } from "@/features/chatbot/mocks";
import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import type {
  AnalysisJobDto,
  AuditDto,
  CreateAuditDto,
  FindingDto,
  FindingStatus,
  ImportFigmaAuditDto,
  DemoVariant,
} from "@/entities/audit/types";

const jobs = new Map<string, AnalysisJobDto>();
// Completed run results by `${auditId}#${version}`; the summary keeps only the latest.
export const runSnapshots = new Map<string, AuditDto>();

function completedVersions(audit: AuditDto) {
  return (audit.runs ?? [])
    .filter((run) => run.status === "completed")
    .map((run) => run.version)
    .sort((a, b) => a - b);
}

function runSnapshot(audit: AuditDto, version: number) {
  const latest = completedVersions(audit).at(-1);
  return runSnapshots.get(`${audit.id}#${version}`) ?? (version === latest ? audit : undefined);
}

// Fixed demo results so the original → revision → comparison flow has something to show.
const demoFindingPlan: Record<DemoVariant, Array<[FindingDto["ruleId"], number]>> = {
  risky: [
    ["DA-04", 2],
    ["DA-04", 2],
    ["DA-04", 2],
    ["DA-07", 1],
    ["DA-07", 5],
    ["DA-12", 4],
    ["DA-15", 6],
  ],
  partial: [
    ["DA-03", 3],
    ["DA-07", 5],
    ["DA-12", 4],
  ],
  revised: [["DA-03", 3]],
};

function mockDemoFindings(audit: AuditDto, version: number): FindingDto[] {
  const template = dashboardFixture.audits
    .flatMap((item) => item.findings)
    .find((item) => item.bbox);
  if (!template || !audit.demoVariant) return audit.findings;
  return demoFindingPlan[audit.demoVariant].flatMap(([ruleId, order], index) => {
    const screen = audit.screens.find((item) => item.order === order);
    if (!screen) return [];
    return [
      {
        ...structuredClone(template),
        id: `${audit.id}-v${version}-${index + 1}`,
        ruleId,
        title: `${ruleId} 모의 탐지`,
        screenIds: [screen.id],
        bbox: { ...template.bbox!, screenId: screen.id },
        relatedElements: [],
        status: "open" as const,
      },
    ];
  });
}

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
  const latest = completedVersions(audit).at(-1);
  if (latest && !runSnapshots.has(`${audit.id}#${latest}`))
    runSnapshots.set(`${audit.id}#${latest}`, structuredClone(audit));
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
        variants: ["risky", "partial", "revised"].map((id) => ({
          id,
          label: id,
          available: true,
          flowName: `릿 크레딧 · ${id} · 6단계`,
        })),
        available: true,
        reason: null,
      },
      android: {
        downloadUrl: "/demo/darkaudit-demo.apk",
        available: true,
        reason: null,
        variants: ["risky", "partial", "revised"].map((id) => ({
          id,
          label: id,
          available: true,
          downloadUrl: `/demo/android/${id}.apk`,
        })),
      },
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
    "*/demo/android/:filename",
    () =>
      new HttpResponse(new Uint8Array([0x50, 0x4b, 3, 4]).buffer, {
        headers: { "Content-Type": "application/vnd.android.package-archive" },
      }),
  ),
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
    const run = addMockRun(audit);
    audit.demoVariant = input.demoVariant;
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
      runId: run.id,
      status: "queued",
      progress: 5,
    };
    jobs.set(job.jobId, job);
    audit.status = "queued";
    return HttpResponse.json(job, { status: 202 });
  }),
  http.post("*/api/v1/audits/:auditId/mobile-app", async ({ params, request }) => {
    const auditId = String(params.auditId);
    const audit = dashboardFixture.audits.find((item) => item.id === auditId);
    if (!audit) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
    const input = import.meta.env.MODE === "test" ? new FormData() : await request.formData();
    const run = addMockRun(audit);
    audit.demoVariant = (input.get("demo_variant") as DemoVariant | null) ?? undefined;
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
      runId: run.id,
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
      if (run && job.status === "completed" && audit.demoPreset)
        audit.findings = mockDemoFindings(audit, run.version);
      if (run) {
        run.status = audit.status;
        run.findingCount = audit.findings.length;
        if (run.status === "completed") {
          audit.latestRunId = run.id;
          runSnapshots.set(`${audit.id}#${run.version}`, structuredClone(audit));
        }
      }
    }
    return HttpResponse.json(job);
  }),
  http.delete("*/api/v1/audits/:auditId", async ({ params }) => {
    const index = dashboardFixture.audits.findIndex((audit) => audit.id === params.auditId);
    if (index < 0) return HttpResponse.json({ message: "Audit not found" }, { status: 404 });
    if (dashboardFixture.audits[index]!.deletionProtected) {
      return HttpResponse.json({ detail: "대표 데모 진단은 삭제할 수 없습니다." }, { status: 403 });
    }
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
  http.get("*/api/v1/audits/:auditId/runs/:version", ({ params }) => {
    const audit = dashboardFixture.audits.find((item) => item.id === params.auditId);
    const run = audit && runSnapshot(audit, Number(params.version));
    if (!run) return HttpResponse.json({ detail: "Run not found" }, { status: 404 });
    return HttpResponse.json({ ...run, runs: audit!.runs });
  }),
  http.get("*/api/v1/audits/:auditId/regression", ({ params, request }) => {
    const audit = dashboardFixture.audits.find((item) => item.id === params.auditId);
    if (!audit) return HttpResponse.json({ detail: "Audit not found" }, { status: 404 });
    const completed = completedVersions(audit);
    if (completed.length < 2)
      return HttpResponse.json({ detail: "비교할 이전 회차가 없습니다." }, { status: 409 });
    const query = new URL(request.url).searchParams;
    const toVersion = Number(query.get("to_version") ?? query.get("to") ?? completed.at(-1));
    const fromVersion = Number(query.get("from_version") ?? query.get("from") ?? completed[0]);
    const before = runSnapshot(audit, fromVersion)?.findings ?? [];
    const after = runSnapshot(audit, toVersion)?.findings ?? [];
    const key = (finding: (typeof before)[number]) =>
      `${finding.ruleId}|${finding.screenIds.join()}`;
    const afterKeys = new Set(after.map(key));
    const beforeKeys = new Set(before.map(key));
    const change = (finding: (typeof before)[number], kept: boolean) => ({
      ruleId: finding.ruleId,
      findingId: finding.id,
      before: beforeKeys.has(key(finding)) ? finding.severity : null,
      after: kept ? finding.severity : null,
      location: finding.title,
      element: finding.element,
    });
    // Mock reruns return the same findings, so they cannot show a real resolution.
    const unchanged =
      before.length === after.length && before.every((finding) => afterKeys.has(key(finding)));
    const counts = (findings: typeof before) => {
      const out = new Map<string, number>();
      findings.forEach((finding) =>
        finding.screenIds.forEach((id) => out.set(id, (out.get(id) ?? 0) + 1)),
      );
      return out;
    };
    const beforeCounts = counts(before);
    const afterCounts = counts(after);
    return HttpResponse.json({
      auditId: audit.id,
      fromVersion,
      toVersion,
      comparisonStatus:
        !before.length && !after.length ? "empty" : unchanged ? "incomplete" : "complete",
      limitations: unchanged ? ["모의 분석 결과이므로 실제 해결 여부를 확인할 수 없습니다."] : [],
      resolvedRatio:
        unchanged || !before.length
          ? null
          : before.filter((f) => !afterKeys.has(key(f))).length / before.length,
      resolved: before
        .filter((finding) => !afterKeys.has(key(finding)))
        .map((f) => change(f, false)),
      improved: [],
      new: after.filter((finding) => !beforeKeys.has(key(finding))).map((f) => change(f, true)),
      regressed: [],
      pending: [],
      persisted: after
        .filter((finding) => beforeKeys.has(key(finding)))
        .map((f) => change(f, true)),
      screenChanges: audit.screens.map((screen) => {
        const b = beforeCounts.get(screen.id) ?? 0;
        const a = afterCounts.get(screen.id) ?? 0;
        return {
          screenId: screen.id,
          flowStep: screen.flowStep,
          beforeCount: b,
          afterCount: a,
          status:
            !b && !a ? "clear" : !b ? "new" : !a ? "resolved" : a < b ? "reduced" : "persisted",
        };
      }),
    });
  }),
];
