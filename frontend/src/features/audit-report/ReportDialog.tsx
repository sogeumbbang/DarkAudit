import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";

import "./audit-report.css";

function isBackdropClick(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX >= bounds.right ||
    event.clientY < bounds.top ||
    event.clientY >= bounds.bottom
  );
}

/** Print preview shared by the audit and comparison reports. */
export function ReportDialog({
  documentTitle,
  onClose,
  children,
}: {
  documentTitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function printReport() {
    setPrinting(true);
    setError("");
    const previousTitle = document.title;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([
          document.fonts?.ready,
          ...Array.from(dialogRef.current?.querySelectorAll("img") ?? []).map((img) =>
            img.decode(),
          ),
        ]),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Image loading timed out")), 15000);
        }),
      ]);
      document.title = documentTitle;
      window.print();
    } catch {
      setError("보고서의 이미지를 불러오지 못했거나 인쇄 창을 열지 못했습니다. 다시 시도해주세요.");
    } finally {
      clearTimeout(timeout);
      document.title = previousTitle;
      setPrinting(false);
    }
  }

  return createPortal(
    <dialog
      className="audit-report-dialog"
      ref={dialogRef}
      aria-label="PDF 보고서 미리보기"
      onCancel={(event) => {
        event.preventDefault();
        if (!printing) onClose();
      }}
      onPointerDown={(event) => {
        backdropPointerDown.current = event.button === 0 && isBackdropClick(event);
      }}
      onPointerCancel={() => {
        backdropPointerDown.current = false;
      }}
      onClick={(event) => {
        const shouldClose = backdropPointerDown.current && isBackdropClick(event);
        backdropPointerDown.current = false;
        if (shouldClose && !printing) onClose();
      }}
    >
      <div className="audit-report-scroll">
        <div className="audit-report-toolbar">
          <div>
            <strong>PDF 보고서 미리보기</strong>
            <p>인쇄 대상에서 ‘PDF로 저장’을 선택하세요. 저장된 수정 결정만 포함됩니다.</p>
            {error && <p role="alert">{error}</p>}
          </div>
          <Button disabled={printing} onClick={printReport}>
            {printing ? "인쇄 준비 중…" : "인쇄 / PDF 저장"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={printing} autoFocus>
            닫기
          </Button>
        </div>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
