import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteAudit } from "@/api/audits";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";

export function useDeleteAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (auditId: string) => deleteAudit(auditId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
  });
}
