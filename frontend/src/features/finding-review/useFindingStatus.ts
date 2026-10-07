import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateFindingStatus } from "@/api/audits";
import type { FindingStatus } from "@/entities/audit/types";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";

export function useFindingStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, status }: { findingId: string; status: FindingStatus }) =>
      updateFindingStatus(findingId, status),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
        // 원본 탭처럼 지난 회차를 보고 있으면 그 회차 결과도 다시 받아야 카드가 바로 바뀐다.
        queryClient.invalidateQueries({ queryKey: ["audit-run"] }),
      ]),
  });
}
