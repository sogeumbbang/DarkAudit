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
  decisionNote: z.string().optional(),
  decisionUpdatedAt: z.string().nullable().optional(),
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
  demoPreset: z
    .object({
      scenario: z.enum(["pet", "travel", "credit", "moa"]),
      source: z.enum(["screenshots", "website", "figma", "android"]),
    })
    .nullable()
    .optional(),
  demoVariant: z.enum(["risky", "partial", "revised"]).nullable().optional(),
  productType: z
    .enum(["insurance", "deposit", "loan", "investment", "other"])
    .nullable()
    .optional(),
  createdAt: z.string().datetime({ offset: true }).nullable().optional(),
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
  latestJobId: z.string().nullable().optional(),
  analysisSummary: z
    .object({
      complete: z.boolean().optional(),
      reviewRequired: z.boolean().optional(),
      supportedRules: z.array(z.string()).optional(),
      unsupportedRules: z.array(z.string()).optional(),
      limitations: z.array(z.string()).optional(),
      analyzedScreenCount: z.number().int().nonnegative().optional(),
      regression: z
        .object({
          comparisonStatus: z.enum(["complete", "incomplete"]),
          limitations: z.array(z.string()),
          pendingCount: z.number().int().nonnegative(),
          resolvedRatio: z.number().min(0).max(1).nullable(),
        })
        .optional(),
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
  source: z.enum(["screenshots", "website", "figma", "android"]).optional(),
  demo: z.boolean().optional(),
  explorationMode: z.enum(["quick", "smart"]).nullable().optional(),
  explorationStage: z.enum(["capturing", "analyzing", "completed", "failed"]).nullable().optional(),
  explorationEvents: z
    .array(
      z.object({
        id: z.number().int().positive(),
        kind: z.enum(["capture", "action", "result", "complete", "stopped"]),
        label: z.string(),
        profile: z.string(),
        imageUrl: z.string(),
        width: z.number().positive(),
        height: z.number().positive(),
        fullPage: z.boolean(),
        x: z.number().min(0).max(1).nullable().optional(),
        y: z.number().min(0).max(1).nullable().optional(),
        actionType: z
          .enum([
            "click",
            "double_click",
            "scroll",
            "type",
            "wait",
            "keypress",
            "drag",
            "move",
            "screenshot",
          ])
          .nullable()
          .optional(),
        scrollX: z.number().int().nullable().optional(),
        scrollY: z.number().int().nullable().optional(),
      }),
    )
    .optional(),
});

const regressionChangeSchema = z.object({
  ruleId: z.string(),
  findingId: z.string().nullable(),
  before: z.enum(["HIGH", "REVIEW", "LOW"]).nullable(),
  after: z.enum(["HIGH", "REVIEW", "LOW"]).nullable(),
  location: z.string().nullable().optional(),
  element: z.string().nullable().optional(),
  verificationNote: z.string().nullable().optional(),
});

export const regressionSchema = z.object({
  scopeDescription: z.string().nullable().optional(),
  auditId: z.string(),
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  comparisonStatus: z.enum(["complete", "incomplete"]),
  limitations: z.array(z.string()),
  resolvedRatio: z.number().min(0).max(1).nullable(),
  resolved: z.array(regressionChangeSchema),
  improved: z.array(regressionChangeSchema),
  persisted: z.array(regressionChangeSchema),
  new: z.array(regressionChangeSchema),
  regressed: z.array(regressionChangeSchema),
  pending: z.array(regressionChangeSchema),
});
