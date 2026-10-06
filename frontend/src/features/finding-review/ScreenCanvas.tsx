import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";

import type { AuditScreenDto, BBoxDto, FindingDto } from "@/entities/audit/types";
import { cn } from "@/lib/cn";

type HighlightBox = {
  key: string;
  bbox: BBoxDto;
  tone: "primary" | "related";
  label: string;
};

function collectHighlights(screenId: string, finding?: FindingDto): HighlightBox[] {
  if (!finding) return [];
  const boxes: HighlightBox[] = [];
  if (finding.bbox && finding.bbox.screenId === screenId) {
    boxes.push({
      key: `${finding.id}-primary`,
      bbox: finding.bbox,
      tone: "primary",
      label: finding.ruleId,
    });
  }
  (finding.relatedElements ?? []).forEach((related, index) => {
    if (related.bbox && related.bbox.screenId === screenId) {
      boxes.push({
        key: `${finding.id}-related-${index}`,
        bbox: related.bbox,
        tone: "related",
        label: "관련",
      });
    }
  });
  return boxes;
}

function toPercentBox(bbox: BBoxDto, natural: { width: number; height: number }, padding = 0) {
  const normalized = bbox.coordinateSystem === "normalized";
  const pct = (value: number, size: number) =>
    normalized ? value * 100 : size > 0 ? (value / size) * 100 : 0;
  return {
    left: `calc(${pct(bbox.x, natural.width)}% - ${padding}px)`,
    top: `calc(${pct(bbox.y, natural.height)}% - ${padding}px)`,
    width: `calc(${pct(bbox.width, natural.width)}% + ${padding * 2}px)`,
    height: `calc(${pct(bbox.height, natural.height)}% + ${padding * 2}px)`,
  };
}

function isCompactControl(bbox: BBoxDto, natural: { width: number; height: number }) {
  const width = bbox.coordinateSystem === "normalized" ? bbox.width * natural.width : bbox.width;
  const height =
    bbox.coordinateSystem === "normalized" ? bbox.height * natural.height : bbox.height;
  return width <= 64 && height <= 64;
}

/**
 * 캡처 이미지 위에 Finding 의 bbox 를 겹쳐 그린다.
 *
 * <img> 는 object-contain 이라 렌더링된 실제 박스가 부모 컨테이너보다 작을 수
 * 있다(letterbox). 퍼센트 좌표를 부모 기준으로 계산하면 실제 화면 요소와
 * 어긋나므로, 렌더링된 <img> 박스 자체를 측정해 그 위에만 오버레이를 그린다.
 */
export function ScreenCanvas({
  screen,
  finding,
  alt,
  className,
  findings,
  onSelect,
  viewportRef,
  focusRequest = 0,
  markersOnly = false,
  onDimensions,
  autoCenter = true,
}: {
  screen: AuditScreenDto;
  finding?: FindingDto;
  alt: string;
  className?: string;
  findings?: { finding: FindingDto; number: number }[];
  onSelect?: (finding: FindingDto) => void;
  viewportRef?: RefObject<HTMLDivElement | null>;
  focusRequest?: number;
  markersOnly?: boolean;
  onDimensions?: (size: { width: number; height: number }) => void;
  autoCenter?: boolean;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const focusedRequest = useRef("");
  const pointerStart = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    dragged: boolean;
  } | null>(null);
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  // 백엔드가 원본 이미지 크기를 안 주는 경우에만 이미지 로드 후 naturalWidth 로 채운다.
  const [measured, setMeasured] = useState<{
    screenId: string;
    width: number;
    height: number;
  } | null>(null);

  const natural = useMemo(
    () =>
      screen.width && screen.height
        ? { width: screen.width, height: screen.height }
        : measured && measured.screenId === screen.id
          ? { width: measured.width, height: measured.height }
          : null,
    [screen.width, screen.height, screen.id, measured],
  );

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;

    // 이미지가 실리기 전에는 크기가 0이라, 그대로 재면 오버레이가 엉뚱한 자리에
    // 한 번 그려졌다가 로드 후 제자리를 찾는다. 화면에서는 박스가 번쩍이고
    // 스크린샷 테스트에서는 간헐적 실패로 나타난다. 유효한 크기가 나올 때만 쓴다.
    const measure = () => {
      if (!img.offsetWidth || !img.offsetHeight) return;
      setRect({
        left: img.offsetLeft,
        top: img.offsetTop,
        width: img.offsetWidth,
        height: img.offsetHeight,
      });
    };

    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    // Centering can move an intrinsic-size image without resizing the image itself.
    if (img.parentElement) observer.observe(img.parentElement);
    return () => observer.disconnect();
  }, [screen.id, screen.imageUrl]);

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    if (img.naturalWidth && img.naturalHeight)
      onDimensions?.({ width: img.naturalWidth, height: img.naturalHeight });
    if ((!screen.width || !screen.height) && img.naturalWidth && img.naturalHeight) {
      setMeasured({ screenId: screen.id, width: img.naturalWidth, height: img.naturalHeight });
    }
    if (!img.offsetWidth || !img.offsetHeight) return;
    setRect({
      left: img.offsetLeft,
      top: img.offsetTop,
      width: img.offsetWidth,
      height: img.offsetHeight,
    });
  }

  const highlights = collectHighlights(screen.id, finding);
  const focusBox = highlights[0]?.bbox;
  const focusKey = `${screen.id}:${screen.imageUrl}:${finding?.id ?? ""}:${focusRequest}:${rect?.width}:${rect?.height}:${rect?.left}:${rect?.top}`;
  useLayoutEffect(() => {
    if (!autoCenter) return;
    const viewport = viewportRef?.current;
    const img = imgRef.current;
    if (!viewport || !img || !natural || !rect || !focusBox || focusedRequest.current === focusKey)
      return;
    const imageBounds = img.getBoundingClientRect();
    if (!imageBounds.width || !imageBounds.height) return;
    const viewportBounds = viewport.getBoundingClientRect();
    const normalized = focusBox.coordinateSystem === "normalized";
    const boxLeft = (imageBounds.width * focusBox.x) / (normalized ? 1 : natural.width);
    const boxTop = (imageBounds.height * focusBox.y) / (normalized ? 1 : natural.height);
    const boxWidth = (imageBounds.width * focusBox.width) / (normalized ? 1 : natural.width);
    const boxHeight = (imageBounds.height * focusBox.height) / (normalized ? 1 : natural.height);
    // Keep the number and leading edge visible when zoom makes the box larger than the viewport.
    const targetX = boxLeft + Math.min(boxWidth / 2, viewport.clientWidth / 2 - 32);
    const targetY = boxTop + Math.min(boxHeight / 2, viewport.clientHeight / 2 - 32);
    viewport.scrollTo?.({
      left:
        viewport.scrollLeft +
        imageBounds.left +
        targetX -
        viewportBounds.left -
        viewport.clientWidth / 2,
      top:
        viewport.scrollTop +
        imageBounds.top +
        targetY -
        viewportBounds.top -
        viewport.clientHeight / 2,
      behavior: "instant",
    });
    focusedRequest.current = focusKey;
  }, [autoCenter, focusBox, focusKey, natural, rect, viewportRef]);

  const interactiveHighlights = (findings ?? []).flatMap(({ finding: item, number }) =>
    collectHighlights(screen.id, item).map((box) => ({ ...box, finding: item, number })),
  );

  return (
    <>
      <img
        alt={alt}
        className={className}
        draggable={false}
        loading="lazy"
        onLoad={handleLoad}
        ref={imgRef}
        src={screen.imageUrl}
      />
      {rect && natural && onSelect && interactiveHighlights.length > 0 && (
        <div
          className="pointer-events-none absolute"
          role="group"
          aria-label="탐지 위치"
          style={{ height: rect.height, left: rect.left, top: rect.top, width: rect.width }}
        >
          {interactiveHighlights.map((box) => {
            const active = box.finding.id === finding?.id;
            const compact = isCompactControl(box.bbox, natural);
            const pin = markersOnly && !active;
            return (
              <button
                key={box.key}
                type="button"
                aria-label={`${box.number}번 ${box.finding.title} ${box.tone === "primary" ? "탐지 영역" : "관련 영역"}`}
                aria-pressed={active}
                aria-controls={finding ? "finding-detail-panel" : undefined}
                title={`${box.number}번 ${box.finding.title} 설명 보기`}
                className={cn(
                  "pointer-events-auto absolute cursor-pointer rounded-[3px] bg-transparent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600",
                  pin
                    ? "border-0"
                    : compact
                      ? [
                          "outline-[1.5px] outline-offset-2",
                          "outline-danger",
                          box.tone === "related" ? "outline-dashed" : "outline-solid",
                        ]
                      : ["border-2", "border-danger", box.tone === "related" && "border-dashed"],
                  active && !compact && box.tone === "primary" && "bg-danger/10",
                )}
                style={
                  pin
                    ? { ...toPercentBox(box.bbox, natural), width: 30, height: 30 }
                    : toPercentBox(box.bbox, natural, compact ? 0 : 2)
                }
                onPointerDown={(event) => {
                  event.stopPropagation();
                  pointerStart.current = {
                    x: event.clientX,
                    y: event.clientY,
                    left: viewportRef?.current?.scrollLeft ?? 0,
                    top: viewportRef?.current?.scrollTop ?? 0,
                    dragged: false,
                  };
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const origin = pointerStart.current;
                  const viewport = viewportRef?.current;
                  if (!origin || !viewport) return;
                  const dx = event.clientX - origin.x;
                  const dy = event.clientY - origin.y;
                  if (Math.hypot(dx, dy) > 6) origin.dragged = true;
                  if (origin.dragged) {
                    viewport.scrollLeft = origin.left - dx;
                    viewport.scrollTop = origin.top - dy;
                  }
                }}
                onPointerCancel={() => {
                  pointerStart.current = null;
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  const origin = pointerStart.current;
                  pointerStart.current = null;
                  if (
                    event.detail > 0 &&
                    origin &&
                    (origin.dragged ||
                      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6)
                  )
                    return;
                  onSelect(box.finding);
                }}
              >
                {/* Keep all numbers above every region without a button stacking context. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -left-0.5 z-10 flex size-7 items-center justify-center rounded-full border-2 bg-white text-xs font-bold text-text shadow-sm",
                    "border-danger",
                    active && "bg-brand-600 text-white border-brand-600",
                  )}
                  style={{
                    top: pin
                      ? 0
                      : (box.bbox.y /
                            (box.bbox.coordinateSystem === "normalized" ? 1 : natural.height)) *
                            rect.height >=
                          26
                        ? -26
                        : 0,
                  }}
                >
                  {box.number}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {rect && natural && !onSelect && highlights.length > 0 && (
        <div
          className="pointer-events-none absolute"
          style={{ height: rect.height, left: rect.left, top: rect.top, width: rect.width }}
        >
          {highlights.map((box) => {
            const compact = isCompactControl(box.bbox, natural);
            return (
              <div
                role="img"
                aria-label={box.tone === "primary" ? `${box.label} 탐지 영역` : "관련 영역"}
                className={cn(
                  "absolute rounded-[3px]",
                  compact
                    ? [
                        "outline-[1.5px] outline-offset-2",
                        box.tone === "related" ? "outline-dashed" : "outline-solid",
                        "outline-danger",
                      ]
                    : ["border-[1.5px]", "border-danger"],
                  !compact && box.tone === "primary" && "bg-danger/10",
                  box.tone === "related" && !compact && "border-dashed",
                )}
                key={box.key}
                style={toPercentBox(box.bbox, natural, compact ? 0 : 2)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

/** Keep labels in normal layout so they cannot cover screenshot content. */
export function ScreenCanvasLegend({
  screenId,
  finding,
}: {
  screenId: string;
  finding?: FindingDto;
}) {
  const highlights = collectHighlights(screenId, finding);
  if (!highlights.length || !finding) return null;
  return (
    <div
      role="group"
      aria-label="탐지 표시 안내"
      className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted"
    >
      {highlights.some((box) => box.tone === "primary") && (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("h-3 w-4 rounded-sm border-[1.5px]", "border-danger")}
          />
          {finding.ruleId} 탐지 영역
        </span>
      )}
      {highlights.some((box) => box.tone === "related") && (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("h-3 w-4 rounded-sm border-[1.5px] border-dashed", "border-danger")}
          />
          관련 영역
        </span>
      )}
    </div>
  );
}
