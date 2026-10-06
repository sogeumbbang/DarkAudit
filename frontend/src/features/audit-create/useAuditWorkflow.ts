import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  analyzeAndroidApp,
  captureAuditUrl,
  createAudit,
  getAnalysisStatus,
  importFigmaAudit,
  startAnalysis,
  uploadAuditScreens,
} from "@/api/audits";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";

export function useCreateAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAudit,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
  });
}

export function useStartAnalysis() {
  return useMutation({ mutationFn: startAnalysis });
}

export function useUploadAuditScreens() {
  return useMutation({ mutationFn: uploadAuditScreens });
}

export function useCaptureAuditUrl() {
  return useMutation({ mutationFn: captureAuditUrl });
}

export function useImportFigmaAudit() {
  return useMutation({ mutationFn: importFigmaAudit });
}

export function useAnalyzeAndroidApp() {
  return useMutation({ mutationFn: analyzeAndroidApp });
}

export function useAnalysisStatus(jobId?: string) {
  return useQuery({
    queryKey: ["analysis-job", jobId],
    queryFn: () => getAnalysisStatus(jobId!),
    enabled: Boolean(jobId),
    // A presenter often switches to slides mid-analysis; keep polling so the
    // result button is ready when they return.
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      // A rejected request or a forgotten job will not recover by polling.
      const status = (query.state.error as { status?: number } | null)?.status;
      if (status === 401 || status === 404) return false;
      return ["completed", "failed"].includes(query.state.data?.status ?? "") ? false : 800;
    },
  });
}
