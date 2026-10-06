import { useQuery } from "@tanstack/react-query";

import { getAuditRegression, getAuditRun } from "@/api/audits";

/** Results of one completed run; the dashboard summary only carries the latest. */
export function useAuditRun(auditId: string | undefined, version: number | undefined) {
  return useQuery({
    queryKey: ["audit-run", auditId, version],
    queryFn: () => getAuditRun(auditId!, version!),
    enabled: Boolean(auditId && version),
    staleTime: 60_000,
  });
}

export function useRegression(
  auditId: string | undefined,
  from: number | undefined,
  to: number | undefined,
  updatedAt?: string,
) {
  return useQuery({
    queryKey: ["regression", auditId, from, to, updatedAt],
    queryFn: () => getAuditRegression(auditId!, from, to),
    enabled: Boolean(auditId && from && to && from < to),
    retry: false,
  });
}
