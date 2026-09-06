export type AuditStatus = "draft" | "queued" | "analyzing" | "completed" | "failed";
export type FindingSeverity = "HIGH" | "REVIEW" | "LOW";
export type FindingStatus = "open" | "reviewing" | "resolved";

export type AuditScreenDto = {
  id: string;
  order: number;
  flowStep: string;
  imageUrl: string;
  findingCount: number;
  width?: number | null;
  height?: number | null;
};

export type BBoxDto = {
  screenId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: "image" | "normalized";
};

export type ElementRefDto = {
  screenId: string;
  description: string;
  bbox?: BBoxDto | null;
  elementType?: string | null;
};

export type FindingDto = {
  id: string;
  ruleId: "DA-02" | "DA-03" | "DA-04" | "DA-05" | "DA-07" | "DA-11" | "DA-12" | "DA-13" | "DA-15";
  riskType:
    | "DECEPTIVE_QUESTION"
    | "PRESELECTED_OPTION"
    | "VISUAL_HIERARCHY_DISTORTION"
    | "FALSE_ADVERTISING"
    | "HIDDEN_INFORMATION"
    | "REPEATED_INTERFERENCE"
    | "EMOTIONAL_LANGUAGE"
    | "SENSORY_MANIPULATION"
    | "SEQUENTIAL_PRICE_DISCLOSURE";
  title: string;
  description: string;
  screenIds: string[];
  element: string;
  defaultState?: string | null;
  costImpact?: string | null;
  severity: FindingSeverity;
  status: FindingStatus;
  confidence: number;
  recommendation: string;
  guideline: string;
  observation?: string | null;
  bbox?: BBoxDto | null;
  relatedElements?: ElementRefDto[];
  mitigated?: boolean;
  combinationWith?: string[];
  combinationRules?: string[];
  triggeredChecks?: string[];
  measurements?: Record<string, unknown> | null;
};

export type AuditRunDto = {
  id: string;
  version: number;
  status: Exclude<AuditStatus, "draft">;
  note?: string | null;
  createdAt: string;
  findingCount: number;
};

export type AnalysisSummary = {
  complete?: boolean;
  supportedRules?: string[];
  limitations?: string[];
  analyzedScreenCount?: number;
  ruleAssessments?: {
    ruleId: string;
    status: "detected" | "not_detected" | "insufficient_evidence" | "not_supported";
    reasons: string[];
  }[];
};

export type AuditDto = {
  id: string;
  name: string;
  platform: "mobile-web" | "desktop-web" | "app";
  status: AuditStatus;
  updatedAt: string;
  screens: AuditScreenDto[];
  findings: FindingDto[];
  runs?: AuditRunDto[];
  latestRunId?: string | null;
  analysisSummary?: AnalysisSummary;
};

export type DashboardSummaryDto = {
  activeAuditId: string | null;
  audits: AuditDto[];
};

export type CreateAuditDto = {
  name: string;
  platform: AuditDto["platform"];
};

export type UploadAuditScreen = { id: string; flowStep: string; file: File };

export type CaptureAuditUrlDto = {
  auditId: string;
  url: string;
  mode: "quick" | "smart";
  profiles: Array<"desktop" | "mobile">;
  goal?: string;
};

export type ImportFigmaAuditDto = {
  auditId: string;
  fileUrl: string;
  target: AuditDto["platform"];
  selectionMode: "prototype-flow" | "all-frames";
  flowName?: string;
};

export type AnalyzeAndroidAppDto = {
  auditId: string;
  appFile: File;
  goal?: string;
};

export type AnalysisJobDto = {
  jobId: string;
  auditId: string;
  status: "queued" | "analyzing" | "completed" | "failed";
  progress: number;
  runId?: string | null;
  error?: string | null;
};
