import { z } from "zod";

import { resolveApiUrl } from "@/api/client";

export const bboxSchema = z.object({
  screenId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  coordinateSystem: z.enum(["image", "normalized"]),
});

export const elementRefSchema = z.object({
  screenId: z.string().min(1),
  description: z.string(),
  bbox: bboxSchema.nullable().optional(),
  elementType: z.string().nullable().optional(),
});

export const findingSchema = z.object({
  id: z.string().min(1),
  ruleId: z.enum(["DA-02", "DA-03", "DA-04", "DA-05", "DA-07", "DA-11", "DA-12", "DA-13", "DA-15"]),
  riskType: z.enum([
    "DECEPTIVE_QUESTION",
    "PRESELECTED_OPTION",
    "VISUAL_HIERARCHY_DISTORTION",
    "FALSE_ADVERTISING",
    "HIDDEN_INFORMATION",
    "REPEATED_INTERFERENCE",
    "EMOTIONAL_LANGUAGE",
    "SENSORY_MANIPULATION",
    "SEQUENTIAL_PRICE_DISCLOSURE",
  ]),
  title: z.string(),
  description: z.string(),
  screenIds: z.array(z.string()),
  element: z.string(),
  defaultState: z.string().nullable().optional(),
  costImpact: z.string().nullable().optional(),
  severity: z.enum(["HIGH", "REVIEW", "LOW"]),
  status: z.enum(["open", "reviewing", "resolved"]),
  confidence: z.number().min(0).max(1),
  recommendation: z.string(),
  guideline: z.string(),
  observation: z.string().nullable().optional(),
  bbox: bboxSchema.nullable().optional(),
  relatedElements: z.array(elementRefSchema).optional(),
  mitigated: z.boolean().optional(),
  combinationWith: z.array(z.string()).optional(),
  combinationRules: z.array(z.string()).optional(),
  triggeredChecks: z.array(z.string()).optional(),
  measurements: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const auditSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  platform: z.enum(["mobile-web", "desktop-web", "app"]),
  status: z.enum(["draft", "queued", "analyzing", "completed", "failed"]),
  updatedAt: z.string().datetime({ offset: true }),
  screens: z.array(
    z.object({
      id: z.string().min(1),
      order: z.number().int().positive(),
      flowStep: z.string().min(1),
      imageUrl: z.string().transform(resolveApiUrl),
      findingCount: z.number().int().nonnegative(),
      width: z.number().int().positive().nullable().optional(),
      height: z.number().int().positive().nullable().optional(),
    }),
  ),
  findings: z.array(findingSchema),
  runs: z
    .array(
      z.object({
        id: z.string(),
        version: z.number().int().positive(),
        status: z.enum(["queued", "analyzing", "completed", "failed"]),
        note: z.string().nullable().optional(),
        createdAt: z.string().datetime({ offset: true }),
        findingCount: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  latestRunId: z.string().nullable().optional(),
  analysisSummary: z
    .object({
      complete: z.boolean().optional(),
      supportedRules: z.array(z.string()).optional(),
      limitations: z.array(z.string()).optional(),
      analyzedScreenCount: z.number().int().nonnegative().optional(),
      ruleAssessments: z
        .array(
          z.object({
            ruleId: z.string(),
            status: z.enum(["detected", "not_detected", "insufficient_evidence", "not_supported"]),
            reasons: z.array(z.string()),
          }),
        )
        .optional(),
    })
    .optional(),
});

export const dashboardSummarySchema = z.object({
  activeAuditId: z.string().nullable(),
  audits: z.array(auditSchema),
});

export const analysisJobSchema = z.object({
  jobId: z.string().min(1),
  auditId: z.string().min(1),
  status: z.enum(["queued", "analyzing", "completed", "failed"]),
  progress: z.number().min(0).max(100),
  runId: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
