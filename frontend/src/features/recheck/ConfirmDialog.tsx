import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#10283373] p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rc-confirm-title"
        className="rc w-full max-w-md rounded-2xl border border-[#e3e6e4] bg-[#fffdfc] p-6"
      >
        <h2 id="rc-confirm-title" className="text-lg font-bold">
          {title}
        </h2>
        <div className="mt-3 text-sm leading-6 text-[#526168]">{children}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} variant="outline" onClick={onCancel}>
            취소
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
