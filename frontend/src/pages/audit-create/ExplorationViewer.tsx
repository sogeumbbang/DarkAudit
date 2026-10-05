import {
  ArrowDown,
  Check,
  Circle,
  Monitor,
  MousePointer2,
  ScanLine,
  Smartphone,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Focus,
  Keyboard,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { resolveApiUrl } from "@/api/client";
import type { AnalysisJobDto, ExplorationEventDto } from "@/entities/audit/types";
import { cn } from "@/lib/cn";
import { useExplorationPlayback } from "./useExplorationPlayback";

export type ExplorationState = {
  mode: "quick" | "smart";
  stage: AnalysisJobDto["explorationStage"];
  events: ExplorationEventDto[];
};

export function ExplorationViewer({
  exploration: { mode, stage, events },
  running,
}: {
  exploration: ExplorationState;
  running: boolean;
}) {
  const [failedImage, setFailedImage] = useState<string>();
  const { frame, following, catchingUp, select, follow } = useExplorationPlayback(events, running);
  const positioned =
    frame?.kind === "action" && frame.x != null && frame.y != null && !frame.fullPage;
  const actionType = frame?.actionType;
  const click = actionType === "click" || actionType === "double_click";
  const scrolling = frame?.kind === "action" && actionType === "scroll";
  const ScrollIcon =
    Math.abs(frame?.scrollX ?? 0) > Math.abs(frame?.scrollY ?? 0)
      ? (frame?.scrollX ?? 0) < 0
        ? ArrowLeft
        : ArrowRight
      : (frame?.scrollY ?? 0) < 0
        ? ArrowUp
        : ArrowDown;
  const observing =
    running &&
    following &&
    !catchingUp &&
    stage === "capturing" &&
    (frame?.kind === "capture" || frame?.kind === "result");
  const animated = running && following;
  const activity = !following
    ? "선택한 탐색 기록"
    : catchingUp
      ? "실행된 동작 재생 중"
      : observing
        ? mode === "smart"
          ? "화면을 관찰하고 다음 동작 판단 중"
          : "화면 수집 중"
        : (frame?.label ?? "검사 브라우저 연결 중");
  const activeRow = useRef<HTMLButtonElement>(null);
  const live = running && stage === "capturing";
  useEffect(() => {
    if (following && activeRow.current) {
      const row = activeRow.current;
      const list = row.parentElement;
      if (list) list.scrollTop = row.offsetTop;
    }
  }, [frame?.id, following]);
  const status = !running
    ? "탐색 기록"
    : stage === "analyzing"
      ? "수집한 화면 분석 중"
      : live
        ? "실시간 화면 수집 중"
        : "브라우저 연결 대기 중";

  return (
    <section
      aria-label="브라우저 탐색 과정"
      className={cn("exploration-viewer mt-8 text-left", animated && "is-animated")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-brand-600">
            {mode === "smart" ? "COMPUTER USE" : "BROWSER CAPTURE"}
          </p>
          <h2 className="mt-1 text-base font-semibold text-brand-900">
            {mode === "smart" ? "AI의 탐색을 함께 보세요" : "화면 수집을 함께 보세요"}
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-muted" role="status">
          <span
            className={cn(
              "exploration-live-dot size-2 rounded-full",
              live ? "bg-success" : "bg-brand-300",
            )}
          />
          {status}
        </span>
      </div>
      <div className="exploration-layout">
        <div className="min-w-0">
          <div className="flex min-h-11 items-center justify-between gap-2 border-y border-line bg-white px-4 text-xs text-muted">
            <span className="inline-flex items-center gap-2">
              {frame?.profile === "mobile" ? <Smartphone size={14} /> : <Monitor size={14} />}
              {frame
                ? `${frame.profile === "mobile" ? "모바일" : "데스크톱"} · ${frame.width} × ${frame.height}`
                : "검사 브라우저"}
            </span>
            <span>
              {following ? (catchingUp ? "동작 따라가는 중" : "최신 화면") : `기록 ${frame?.id}`}
            </span>
          </div>
          <div className="exploration-activity" aria-live="polite" aria-atomic="true">
            {positioned ? (
              <Focus size={18} />
            ) : scrolling ? (
              <ScrollIcon size={18} />
            ) : (
              <ScanLine size={18} />
            )}
            <span>{activity}</span>
            {positioned && <span className="exploration-focus-label">조작 지점 확대</span>}
          </div>
          <div className="exploration-screen">
            {frame && failedImage !== frame.imageUrl ? (
              <div
                className={cn("exploration-frame", positioned && "is-focused")}
                style={{
                  transformOrigin: positioned ? `${frame.x! * 100}% ${frame.y! * 100}%` : "50% 50%",
                }}
              >
                <img
                  key={frame.imageUrl}
                  src={resolveApiUrl(frame.imageUrl)}
                  alt={`${frame.label} — ${frame.profile === "mobile" ? "모바일" : "데스크톱"} 검사 화면`}
                  onError={() => setFailedImage(frame.imageUrl)}
                />
                {observing && <span className="exploration-scan" aria-hidden="true" />}
                {positioned && (
                  <>
                    <span
                      className="exploration-focus"
                      aria-hidden="true"
                      style={{ left: `${frame.x! * 100}%`, top: `${frame.y! * 100}%` }}
                    />
                    <span
                      key={frame.id}
                      className={cn("exploration-pointer", click && "is-click")}
                      style={{ left: `${frame.x! * 100}%`, top: `${frame.y! * 100}%` }}
                      aria-label="동작 위치"
                      role="img"
                    >
                      <MousePointer2 size={22} fill="currentColor" />
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="px-6 py-20 text-center text-sm leading-7 text-muted">
                <ScanLine className="mx-auto mb-4 text-brand-500" size={32} />
                {frame
                  ? "이 화면을 불러올 수 없습니다. 다른 탐색 기록을 선택해 주세요."
                  : running
                    ? "첫 화면이 도착하면 실제 검사 화면이 여기에 표시됩니다."
                    : "수집된 탐색 화면이 없습니다."}
              </div>
            )}
            {frame && failedImage !== frame.imageUrl && scrolling && (
              <div
                key={frame.id}
                className="exploration-scroll"
                role="img"
                aria-label={frame.label}
              >
                <ScrollIcon size={30} />
                <span>화면 이동</span>
              </div>
            )}
            {frame &&
              failedImage !== frame.imageUrl &&
              frame.kind === "action" &&
              (actionType === "type" || actionType === "keypress") && (
                <div className="exploration-scroll">
                  <Keyboard size={24} />
                  <span>{frame.label}</span>
                </div>
              )}
          </div>
          <p className="border-t border-line px-4 py-3 text-xs leading-5 text-muted">
            {frame ? `${frame.id}. ${frame.label}` : "실제 브라우저 캡처와 실행 기록을 표시합니다."}
            {frame?.kind === "action" && " · 실제 동작 직전의 화면입니다."}
            {observing && " · 화면 관찰 중이며, 정확한 읽기 위치는 제공되지 않습니다."}
          </p>
        </div>
        <div className="exploration-history min-w-0">
          <div className="flex min-h-11 items-center justify-between border-y border-line px-4">
            <h3 className="text-xs font-semibold">
              탐색 기록 <span className="ml-1 text-muted">{events.length}</span>
            </h3>
            {!following && (
              <button
                type="button"
                className="text-xs font-semibold text-brand-700 underline"
                onClick={follow}
              >
                최신 화면 보기
              </button>
            )}
          </div>
          <div className="exploration-events" aria-label="탐색 단계">
            {events.length === 0 && (
              <p className="p-4 text-xs leading-6 text-muted">실행된 단계가 순서대로 쌓입니다.</p>
            )}
            {events.map((event) => {
              const Icon =
                event.kind === "action"
                  ? event.actionType === "scroll"
                    ? ArrowDown
                    : MousePointer2
                  : event.kind === "complete"
                    ? Check
                    : event.kind === "result"
                      ? ArrowDown
                      : Circle;
              return (
                <button
                  type="button"
                  key={event.id}
                  ref={event.id === frame?.id ? activeRow : undefined}
                  className={cn("exploration-event", event.id === frame?.id && "is-selected")}
                  aria-pressed={event.id === frame?.id}
                  onClick={() => select(event.id)}
                >
                  <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>
                    <span className="block text-xs font-medium">
                      {event.id}. {event.label}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted">
                      {event.profile === "mobile" ? "모바일" : "데스크톱"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
