import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";

import type { AuditScreenDto, BBoxDto, FindingDto, FindingSeverity } from "@/entities/audit/types";
import { cn } from "@/lib/cn";

type HighlightBox = {
  key: string;
  bbox: BBoxDto;
  tone: "primary" | "related";
  label: string;
  severity: FindingSeverity;
};

const BORDER: Record<FindingSeverity, string> = {
  HIGH: "border-danger",
  REVIEW: "border-warning",
  LOW: "border-brand-500",
};

const OUTLINE: Record<FindingSeverity, string> = {
  HIGH: "outline-danger",
  REVIEW: "outline-warning",
  LOW: "outline-brand-500",
};

const FILL: Record<FindingSeverity, string> = {
  HIGH: "bg-danger/10",
  REVIEW: "bg-warning/10",
  LOW: "bg-brand-500/10",
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
      severity: finding.severity,
    });
  }
  (finding.relatedElements ?? []).forEach((related, index) => {
    if (related.bbox && related.bbox.screenId === screenId) {
      boxes.push({
        key: `${finding.id}-related-${index}`,
        bbox: related.bbox,
        tone: "related",
        label: "관련",
        severity: finding.severity,
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
}: {
  screen: AuditScreenDto;
  finding?: FindingDto;
  alt: string;
  className?: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
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

  const natural =
    screen.width && screen.height
      ? { width: screen.width, height: screen.height }
      : measured && measured.screenId === screen.id
        ? { width: measured.width, height: measured.height }
        : null;

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
    return () => observer.disconnect();
  }, [screen.id, screen.imageUrl]);

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    if (!screen.width && !screen.height && img.naturalWidth && img.naturalHeight) {
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
      {rect && natural && highlights.length > 0 && (
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
                        OUTLINE[box.severity],
                      ]
                    : ["border-[1.5px]", BORDER[box.severity]],
                  !compact && box.tone === "primary" && FILL[box.severity],
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
            className={cn("h-3 w-4 rounded-sm border-[1.5px]", BORDER[finding.severity])}
          />
          {finding.ruleId} 탐지 영역
        </span>
      )}
      {highlights.some((box) => box.tone === "related") && (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "h-3 w-4 rounded-sm border-[1.5px] border-dashed",
              BORDER[finding.severity],
            )}
          />
          관련 영역
        </span>
      )}
    </div>
  );
}
