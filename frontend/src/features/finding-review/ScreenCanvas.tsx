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

const FILL: Record<FindingSeverity, string> = {
  HIGH: "bg-danger/10",
  REVIEW: "bg-warning/10",
  LOW: "bg-brand-500/10",
};

const BADGE: Record<FindingSeverity, string> = {
  HIGH: "bg-danger",
  REVIEW: "bg-warning",
  LOW: "bg-brand-600",
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

function toPercentBox(bbox: BBoxDto, natural: { width: number; height: number }) {
  const normalized = bbox.coordinateSystem === "normalized";
  const pct = (value: number, size: number) =>
    normalized ? value * 100 : size > 0 ? (value / size) * 100 : 0;
  return {
    left: `${pct(bbox.x, natural.width)}%`,
    top: `${pct(bbox.y, natural.height)}%`,
    width: `${pct(bbox.width, natural.width)}%`,
    height: `${pct(bbox.height, natural.height)}%`,
  };
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

    const measure = () =>
      setRect({
        left: img.offsetLeft,
        top: img.offsetTop,
        width: img.offsetWidth,
        height: img.offsetHeight,
      });

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
      <img alt={alt} className={className} loading="lazy" onLoad={handleLoad} ref={imgRef} src={screen.imageUrl} />
      {rect && natural && highlights.length > 0 && (
        <div
          className="pointer-events-none absolute"
          style={{ height: rect.height, left: rect.left, top: rect.top, width: rect.width }}
        >
          {highlights.map((box) => (
            <div
              className={cn(
                "absolute rounded-[3px] border-2",
                BORDER[box.severity],
                box.tone === "primary" ? FILL[box.severity] : "border-dashed",
              )}
              key={box.key}
              style={toPercentBox(box.bbox, natural)}
            >
              {/*
                라벨을 박스 안에 넣으면 얇은 요소(체크박스 한 줄 등)에서 박스보다
                커져 삐져나온다. 박스 위쪽 바깥에 붙이되, 위 여백이 없는 경우
                (화면 최상단 요소)에는 안쪽으로 되돌린다.
              */}
              <span
                className={cn(
                  "absolute left-0 whitespace-nowrap rounded px-1 py-px text-[9px] font-bold leading-tight text-white",
                  parseFloat(String(toPercentBox(box.bbox, natural).top)) > 4
                    ? "bottom-full mb-0.5"
                    : "top-0",
                  BADGE[box.severity],
                  box.tone === "related" && "opacity-80",
                )}
              >
                {box.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
