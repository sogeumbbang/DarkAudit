import { useEffect, useState } from "react";

import { WORKSPACE_REJECTED_EVENT, resetWorkspace } from "@/api/client";
import { Button } from "@/components/ui/Button";

// Shown when the server no longer recognizes this browser's workspace key,
// e.g. after a deployment without a persistent disk reset the database.
export function WorkspaceRecoveryBanner() {
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const onRejected = () => setRejected(true);
    window.addEventListener(WORKSPACE_REJECTED_EVENT, onRejected);
    return () => window.removeEventListener(WORKSPACE_REJECTED_EVENT, onRejected);
  }, []);

  if (!rejected) return null;
  return (
    <div
      role="alert"
      className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-control border border-border bg-brand-50 p-4 text-sm"
    >
      <p className="min-w-0 flex-1 leading-6">
        서버가 이 브라우저의 작업공간을 찾지 못했습니다. 서버가 초기화되었다면 이전 진단 기록은
        복구할 수 없습니다.
      </p>
      <Button
        variant="primary"
        onClick={() => {
          resetWorkspace();
          window.location.reload();
        }}
      >
        새 작업공간으로 시작
      </Button>
    </div>
  );
}
