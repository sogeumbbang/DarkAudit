import { useQuery } from "@tanstack/react-query";

import { getDashboardSummary } from "@/api/dashboard";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: () => [...dashboardKeys.all, "summary"] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: getDashboardSummary,
    refetchInterval: (query) =>
      query.state.data?.audits.some((audit) => ["queued", "analyzing"].includes(audit.status))
        ? 3000
        : false,
  });
}
