import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import type { AuditDto, FindingDto } from "@/entities/audit/types";
import { orderFindings } from "@/entities/audit/orderFindings";
import { ReportScreen } from "./ReportScreen";

import "./audit-report.css";

const statuses = { open: "검토 필요", reviewing: "검토 중", resolved: "해결됨" };
const assessments = {
  detected: "탐지됨",
  not_detected: "미탐지",
  insufficient_evidence: "근거 부족",
  not_supported: "미지원",
};

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

function ReportFinding({
  finding,
  number,
  audit,
}: {
  finding: FindingDto;
  number: number;
  audit: AuditDto;
}) {
  return (
    <section className="audit-report-finding">
      <h3>
        {number}. {finding.title} ({finding.ruleId})
      </h3>
      <p className="audit-report-finding-meta">
        상태: {statuses[finding.status]} · 신뢰도: {Math.round(finding.confidence * 100)}%
      </p>
      <p className="audit-report-finding-meta">
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
      <p>
        <strong>검토 기준: </strong>
        {finding.guideline}
      </p>
      <p className="audit-report-recommendation">
        <strong>개선 권고안: </strong>
        {finding.recommendation}
      </p>
      <p>
        <strong>수정 결정 기록: </strong>
        {finding.decisionNote || "저장된 기록이 없습니다."}
      </p>
    </section>
  );
}

export function AuditReport({ audit, onClose }: { audit: AuditDto; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const summary = audit.analysisSummary;
  const screens = [...audit.screens].sort((a, b) => a.order - b.order);
  const numberedFindings = orderFindings(audit).map((finding, index) => ({
    finding,
    number: index + 1,
  }));
  const unassignedFindings = numberedFindings.filter(
    ({ finding }) => !screens.some((screen) => finding.screenIds.includes(screen.id)),
  );

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
        <article className="audit-report-document">
          <header className="audit-report-cover">
            <div className="audit-report-masthead">
              <span>DarkAudit</span>
              <span>금융상품 UX 진단</span>
            </div>
            <h1>다크패턴 분석 보고서</h1>
            <h2 className="audit-report-project-name">{audit.name}</h2>
            <dl className="audit-report-metadata">
              <div>
                <dt>진단 ID</dt>
                <dd>{audit.id}</dd>
              </div>
              <div>
                <dt>플랫폼</dt>
                <dd>
                  {
                    { "mobile-web": "모바일 웹", "desktop-web": "데스크톱 웹", app: "앱" }[
                      audit.platform
                    ]
                  }
                </dd>
              </div>
              <div>
                <dt>최근 수정</dt>
                <dd>{new Date(audit.updatedAt).toLocaleString("ko-KR")}</dd>
              </div>
              <div>
                <dt>진단 상태</dt>
                <dd>
                  {
                    {
                      draft: "준비 중",
                      queued: "대기 중",
                      analyzing: "진단 중",
                      completed: "완료",
                      failed: "실패",
                    }[audit.status]
                  }
                </dd>
              </div>
            </dl>
          </header>
          <section className="audit-report-summary">
            <h2>01. 진단 요약</h2>
            <dl className="audit-report-totals">
              <div>
                <dt>대상 화면</dt>
                <dd>
                  {audit.screens.length}
                  <span>개</span>
                </dd>
              </div>
              <div>
                <dt>탐지 항목</dt>
                <dd>
                  {audit.findings.length}
                  <span>건</span>
                </dd>
              </div>
              <div>
                <dt>검토 필요</dt>
                <dd>
                  {audit.findings.filter((finding) => finding.status !== "resolved").length}
                  <span>건</span>
                </dd>
              </div>
              <div>
                <dt>해결됨</dt>
                <dd>
                  {audit.findings.filter((finding) => finding.status === "resolved").length}
                  <span>건</span>
                </dd>
              </div>
            </dl>
          </section>
          <section className="audit-report-scope">
            <h2>02. 분석 범위와 한계</h2>
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
          {!audit.findings.length && (
            <p>탐지된 항목이 없습니다. 분석 범위와 한계를 함께 확인하세요.</p>
          )}
          {screens.map((screen) => {
            const screenFindings = numberedFindings.filter(({ finding }) =>
              finding.screenIds.includes(screen.id),
            );
            return (
              <section
                className="audit-report-screen"
                key={screen.id}
                aria-label={`화면 ${screen.order}. ${screen.flowStep}`}
              >
                <div className="audit-report-screen-heading">
                  <p className="audit-report-brand">03. 화면별 검토 결과</p>
                  <h2>
                    {screen.order}. {screen.flowStep}
                  </h2>
                  <p>관련 탐지 항목 {screenFindings.length}건</p>
                </div>
                <div className="audit-report-columns">
                  <figure>
                    <figcaption>분석 대상 화면</figcaption>
                    <ReportScreen screen={screen} findings={screenFindings} />
                  </figure>
                  <div className="audit-report-screen-findings">
                    <p className="audit-report-column-label">탐지 항목 및 개선 권고</p>
                    {screenFindings.length ? (
                      screenFindings.map(({ finding, number }) => (
                        <ReportFinding
                          key={finding.id}
                          finding={finding}
                          number={number}
                          audit={audit}
                        />
                      ))
                    ) : (
                      <div className="audit-report-empty">
                        <p>이 화면에 연결된 탐지 항목이 없습니다.</p>
                        <p>
                          미탐지가 화면의 안전을 보장하지는 않습니다. 분석 범위와 한계를 함께
                          확인하세요.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
          {unassignedFindings.length > 0 && (
            <section className="audit-report-unassigned" aria-label="대상 화면을 확인할 항목">
              <h2>부록. 대상 화면을 확인할 항목</h2>
              <p>연결된 화면이 없거나 보고서에 포함되지 않은 항목입니다.</p>
              {unassignedFindings.map(({ finding, number }) => (
                <ReportFinding key={finding.id} finding={finding} number={number} audit={audit} />
              ))}
            </section>
          )}
        </article>
      </div>
    </dialog>,
    document.body,
  );
}
