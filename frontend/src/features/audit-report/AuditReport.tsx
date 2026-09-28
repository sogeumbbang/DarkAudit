import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import type { AuditDto } from "@/entities/audit/types";

import "./audit-report.css";

const statuses = { open: "검토 필요", reviewing: "검토 중", resolved: "해결됨" };
const severities = { HIGH: "높음", REVIEW: "검토 필요", LOW: "낮음" };
const assessments = {
  detected: "탐지됨",
  not_detected: "미탐지",
  insufficient_evidence: "근거 부족",
  not_supported: "미지원",
};

export function AuditReport({ audit, onClose }: { audit: AuditDto; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const summary = audit.analysisSummary;

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
      document.title = `DarkAudit 보고서 - ${audit.name}`;
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
      onCancel={onClose}
    >
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
      <article className="audit-report-document">
        <header>
          <p className="audit-report-brand">DarkAudit · 금융상품 UX 진단</p>
          <h1>{audit.name}</h1>
          <p>다크패턴 분석 보고서</p>
          <p>
            플랫폼:{" "}
            {{ "mobile-web": "모바일 웹", "desktop-web": "데스크톱 웹", app: "앱" }[audit.platform]}
            {" · "}최근 수정: {new Date(audit.updatedAt).toLocaleString("ko-KR")}
          </p>
          <p>진단 ID: {audit.id}</p>
          <p>
            진단 상태:{" "}
            {
              {
                draft: "준비 중",
                queued: "대기 중",
                analyzing: "진단 중",
                completed: "완료",
                failed: "실패",
              }[audit.status]
            }
          </p>
        </header>
        <section>
          <h2>진단 요약</h2>
          <p>
            화면 {audit.screens.length}개 · 탐지 {audit.findings.length}건 · 검토 필요{" "}
            {audit.findings.filter((finding) => finding.status !== "resolved").length}건 · 해결됨{" "}
            {audit.findings.filter((finding) => finding.status === "resolved").length}건
          </p>
        </section>
        <section>
          <h2>분석 범위와 한계</h2>
          <p>
            {summary?.complete === true
              ? "수집한 화면의 지원 규칙 검사 완료"
              : "분석 완료 여부를 확인하거나 추가 검토가 필요합니다."}
          </p>
          <p>탐지되지 않은 항목이나 수집하지 않은 화면의 안전을 보장하지 않습니다.</p>
          {summary?.supportedRules && (
            <p>지원 규칙: {summary.supportedRules.join(", ") || "없음"}</p>
          )}
          {summary?.analyzedScreenCount !== undefined && (
            <p>분석 화면: {summary.analyzedScreenCount}개</p>
          )}
          {summary?.limitations?.map((limitation, index) => (
            <p key={index}>{limitation}</p>
          ))}
          {summary?.ruleAssessments?.map((assessment) => (
            <p key={assessment.ruleId}>
              {assessment.ruleId}: {assessments[assessment.status]}
              {assessment.reasons.length > 0 && ` — ${assessment.reasons.join(" / ")}`}
            </p>
          ))}
        </section>
        <section>
          <h2>탐지 항목 및 개선 권고</h2>
          {!audit.findings.length && (
            <p>탐지된 항목이 없습니다. 분석 범위와 한계를 함께 확인하세요.</p>
          )}
          {audit.findings.map((finding, index) => (
            <section className="audit-report-finding" key={finding.id}>
              <h3>
                {index + 1}. {finding.title} ({finding.ruleId})
              </h3>
              <p>
                심각도: {severities[finding.severity]} · 상태: {statuses[finding.status]} · 신뢰도:{" "}
                {Math.round(finding.confidence * 100)}%
              </p>
              <p>
                대상 화면:{" "}
                {finding.screenIds
                  .map((id) => audit.screens.find((screen) => screen.id === id)?.flowStep ?? id)
                  .join(", ") || "미지정"}
              </p>
              <p>{finding.description}</p>
              {finding.observation && (
                <p>
                  <strong>관찰 근거: </strong>
                  {finding.observation}
                </p>
              )}
              <p>
                <strong>대상 요소: </strong>
                {finding.element}
              </p>
              {finding.defaultState && (
                <p>
                  <strong>기본 상태: </strong>
                  {finding.defaultState}
                </p>
              )}
              {finding.costImpact && (
                <p>
                  <strong>추가 비용: </strong>
                  {finding.costImpact}
                </p>
              )}
              <p>
                <strong>검토 기준: </strong>
                {finding.guideline}
              </p>
              <p>
                <strong>개선 권고안: </strong>
                {finding.recommendation}
              </p>
              <p>
                <strong>수정 결정 기록: </strong>
                {finding.decisionNote || "저장된 기록이 없습니다."}
              </p>
            </section>
          ))}
        </section>
        <section className="audit-report-screens">
          <h2>분석 대상 화면</h2>
          {[...audit.screens]
            .sort((a, b) => a.order - b.order)
            .map((screen) => (
              <figure key={screen.id}>
                <figcaption>
                  {screen.order}. {screen.flowStep}
                </figcaption>
                <img src={screen.imageUrl} alt={`${screen.flowStep} 분석 대상 화면`} />
              </figure>
            ))}
        </section>
      </article>
    </dialog>,
    document.body,
  );
}
