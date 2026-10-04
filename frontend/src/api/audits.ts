import { apiRequest, warmUpApi } from "@/api/client";
import { analysisJobSchema, auditSchema, regressionSchema } from "@/api/schemas";
import type {
  AnalyzeAndroidAppDto,
  AuditDto,
  CreateAuditDto,
  CaptureAuditUrlDto,
  FindingStatus,
  ImportFigmaAuditDto,
  UploadAuditScreen,
  DemoVariant,
} from "@/entities/audit/types";

export async function createAudit(input: CreateAuditDto) {
  await warmUpApi();
  return auditSchema.parse(
    await apiRequest<unknown>("/api/v1/audits", { method: "POST", body: JSON.stringify(input) }),
  );
}

export function uploadAuditScreens({
  auditId,
  screens,
  demoVariant,
}: {
  auditId: string;
  screens: UploadAuditScreen[];
  demoVariant?: DemoVariant;
}) {
  const body = new FormData();
  if (demoVariant) body.append("demo_variant", demoVariant);
  screens.forEach((screen) => {
    body.append("files", screen.file, screen.file.name);
    body.append("screen_ids", screen.id);
    body.append("flow_steps", screen.flowStep);
  });
  return apiRequest<AuditDto>(`/api/v1/audits/${auditId}/screens`, {
    method: "POST",
    body,
    headers: {
      "X-DarkAudit-Screen-Metadata": encodeURIComponent(
        JSON.stringify(
          screens.map((screen) => ({
            id: screen.id,
            flowStep: screen.flowStep,
            fileName: screen.file.name,
            demoVariant,
          })),
        ),
      ),
    },
    timeoutMs: 120_000,
  });
}

export async function startAnalysis(auditId: string) {
  return analysisJobSchema.parse(
    await apiRequest<unknown>(`/api/v1/audits/${auditId}/analyze`, { method: "POST" }),
  );
}

export async function captureAuditUrl({ auditId, ...input }: CaptureAuditUrlDto) {
  return analysisJobSchema.parse(
    await apiRequest<unknown>(`/api/v1/audits/${auditId}/capture`, {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 120_000,
    }),
  );
}

export async function importFigmaAudit({ auditId, ...input }: ImportFigmaAuditDto) {
  return analysisJobSchema.parse(
    await apiRequest<unknown>(`/api/v1/audits/${auditId}/figma`, {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 120_000,
    }),
  );
}

export async function analyzeAndroidApp({
  auditId,
  appFile,
  goal,
  demoVariant,
}: AnalyzeAndroidAppDto) {
  const body = new FormData();
  body.append("app", appFile, appFile.name);
  if (demoVariant) body.append("demo_variant", demoVariant);
  if (goal) body.append("goal", goal);
  return analysisJobSchema.parse(
    await apiRequest<unknown>(`/api/v1/audits/${auditId}/mobile-app`, {
      method: "POST",
      body,
      timeoutMs: 120_000,
    }),
  );
}

export async function getAnalysisStatus(jobId: string) {
  return analysisJobSchema.parse(await apiRequest<unknown>(`/api/v1/analysis-jobs/${jobId}`));
}

export function deleteAudit(auditId: string) {
  return apiRequest<void>(`/api/v1/audits/${auditId}`, { method: "DELETE" });
}

export async function getAuditRegression(auditId: string, from: number, to: number) {
  return regressionSchema.parse(
    await apiRequest<unknown>(
      `/api/v1/audits/${encodeURIComponent(auditId)}/regression?from=${from}&to=${to}`,
    ),
  );
}

export function updateFindingStatus(findingId: string, status: FindingStatus) {
  return apiRequest<{ id: string; status: FindingStatus }>(`/api/v1/findings/${findingId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function saveFindingDecision(findingId: string, decisionNote: string) {
  return apiRequest<{ id: string; decisionNote: string; decisionUpdatedAt: string }>(
    `/api/v1/findings/${findingId}/decision`,
    { method: "PUT", body: JSON.stringify({ decisionNote }) },
  );
}
