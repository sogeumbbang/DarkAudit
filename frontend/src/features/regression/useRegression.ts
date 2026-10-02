import { useQuery } from "@tanstack/react-query";

import { ApiError } from "@/api/client";
import { getRegression } from "@/api/audits";
import type { RegressionDto } from "@/entities/audit/types";

export const regressionKeys = {
  all: ["regression"] as const,
  audit: (auditId: string) => [...regressionKeys.all, auditId] as const,
};

/** 이전 회차가 없어 비교할 수 없는 경우(409)는 오류가 아니라 null 로 돌려준다. */
export async function loadRegression(auditId: string): Promise<RegressionDto | null> {
  try {
    return await getRegression(auditId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return null;
    throw error;
  }
}

export function useRegression(auditId?: string) {
  return useQuery({
    queryKey: regressionKeys.audit(auditId ?? ""),
    queryFn: () => loadRegression(auditId!),
    enabled: Boolean(auditId),
    // 재진단이 끝난 직후 다시 열었을 때 이전 결과가 남지 않게 한다.
    staleTime: 0,
  });
}
