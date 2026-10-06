import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import type { AuditDto } from "@/entities/audit/types";
import { displayName } from "./runs";
import "@/pages/overview/overview.css";

const statusPresentation: Record<
  AuditDto["status"],
  { label: string; variant: "neutral" | "progress" | "success" | "danger" }
> = {
  draft: { label: "준비 중", variant: "neutral" },
  queued: { label: "대기 중", variant: "progress" },
  analyzing: { label: "진단 중", variant: "progress" },
  completed: { label: "완료", variant: "success" },
  failed: { label: "실패", variant: "danger" },
};

/**
 * One header for the result, revision and comparison screens, so moving between
 * steps keeps the title, back link and actions in the same place.
 */
export function AuditFlowHeader({
  audit,
  kicker,
  pageTitle,
  subtitle,
  badge,
  actions,
  children,
}: {
  audit: AuditDto;
  kicker: string;
  pageTitle: string;
  subtitle: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const status = statusPresentation[audit.status];
  return (
    <header className="overview-header">
      <div className="overview-heading">
        <Link
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-brand-600"
          to="/app/audits"
        >
          <ChevronLeft size={14} />
          진단 관리
        </Link>
        <p className="overview-kicker">{kicker}</p>
        <h1 className="sr-only">{pageTitle}</h1>
        <div className="overview-title-row rc">
          <Badge variant={status.variant}>{status.label}</Badge>
          <h2 className="review-audit-title font-display">{displayName(audit.name)}</h2>
          {badge}
        </div>
        <p className="overview-subtitle">{subtitle}</p>
        {children}
      </div>
      {actions && <div className="overview-actions">{actions}</div>}
    </header>
  );
}
