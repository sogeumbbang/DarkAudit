import { Expand, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { AuditScreenDto, FindingDto } from "@/entities/audit/types";
import { ScreenCanvas } from "@/features/finding-review/ScreenCanvas";
import { cn } from "@/lib/cn";

export function ScreenPreview({
  screen,
  finding,
  findings,
  onSelect,
  focusRequest,
  onReset,
  emptyMessage,
}: {
  screen: AuditScreenDto;
  finding?: FindingDto;
  findings: { finding: FindingDto; number: number }[];
  onSelect: (finding: FindingDto) => void;
  focusRequest: number;
  onReset: () => void;
  emptyMessage?: string;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 600, height: 600 });
  const [imageSize, setImageSize] = useState({
    width: screen.width || 390,
    height: screen.height || 844,
  });
  const selection = `${finding?.id ?? "overview"}:${focusRequest}`;
  const [manualZoom, setManualZoom] = useState<{ selection: string; scale: number }>();
  const [isPanning, setIsPanning] = useState(false);
  const panOrigin = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      if (viewport.clientWidth && viewport.clientHeight)
        setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const fit = Math.max(
    0.01,
    Math.min(
      (viewportSize.width - 64) / imageSize.width,
      (viewportSize.height - 64) / imageSize.height,
    ),
  );
  const box =
    finding?.bbox?.screenId === screen.id
      ? finding.bbox
      : finding?.relatedElements?.find((item) => item.bbox?.screenId === screen.id)?.bbox;
  const boxWidth = box
    ? box.width * (box.coordinateSystem === "normalized" ? imageSize.width : 1)
    : 0;
  const boxHeight = box
    ? box.height * (box.coordinateSystem === "normalized" ? imageSize.height : 1)
    : 0;
  // Include surrounding context and cap zoom for very small controls.
  const selectedScale =
    boxWidth > 0 && boxHeight > 0
      ? Math.max(
          1.4,
          Math.min(
            3,
            (viewportSize.width - 96) / (boxWidth * fit),
            (viewportSize.height - 112) / (boxHeight * fit),
          ),
        )
      : 1;
  const scale =
    manualZoom?.selection === selection ? manualZoom.scale : finding ? selectedScale : 1;
  const setScale = (value: number) =>
    setManualZoom({ selection, scale: Math.max(0.5, Math.min(5, value)) });
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    panOrigin.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    setIsPanning(true);
  }
  function stopPan(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    panOrigin.current = null;
    setIsPanning(false);
  }
  return (
    <div id="finding-screen-preview" className="map-preview" ref={previewRef} tabIndex={-1}>
      <div className="map-preview-heading">
        <div>
          <h2 className="text-sm font-semibold">
            {screen.order}. {screen.flowStep}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {finding ? "선택한 문제의 위치를 보고 있습니다" : "문제 번호를 눌러 자세히 살펴보세요"}
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-control border border-border bg-white px-3 py-2 text-xs font-semibold"
          onClick={() => {
            setManualZoom(undefined);
            onReset();
            viewportRef.current?.scrollTo?.({ top: 0, left: 0 });
          }}
        >
          <RotateCcw size={14} />
          화면 전체 보기
        </button>
      </div>
      <div
        ref={viewportRef}
        role="region"
        aria-label="화면 미리보기 이동 영역"
        tabIndex={0}
        data-testid="screen-preview-viewport"
        className={cn(
          "map-viewport scrollbar-hidden overflow-auto touch-none select-none",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={startPan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onPointerMove={(event) => {
          const origin = panOrigin.current;
          if (!origin || origin.pointerId !== event.pointerId) return;
          event.currentTarget.scrollLeft = origin.left - (event.clientX - origin.x);
          event.currentTarget.scrollTop = origin.top - (event.clientY - origin.y);
        }}
      >
        <div
          className="flex min-h-full min-w-full items-center justify-center p-8"
          data-testid="screen-preview-scroll-area"
          style={{
            width: Math.max(viewportSize.width, imageSize.width * fit * scale + 64),
            height: Math.max(viewportSize.height, imageSize.height * fit * scale + 64),
          }}
        >
          <div
            className="relative shrink-0"
            style={{ width: imageSize.width * fit * scale, height: imageSize.height * fit * scale }}
          >
            <ScreenCanvas
              alt={`${screen.flowStep} 캡처 화면 미리보기`}
              className="block h-full w-full rounded bg-white shadow-lg"
              screen={screen}
              finding={finding}
              findings={findings}
              onSelect={(next) => {
                if (document.fullscreenElement)
                  void document.exitFullscreen().then(() => onSelect(next));
                else onSelect(next);
              }}
              viewportRef={viewportRef}
              focusRequest={focusRequest}
              markersOnly
              onDimensions={(size) => {
                if (!screen.width || !screen.height) setImageSize(size);
              }}
            />
          </div>
        </div>
      </div>
      <div className="map-zoom-controls">
        <button aria-label="확대" onClick={() => setScale(scale + 0.25)}>
          <ZoomIn size={18} />
        </button>
        <output aria-label="미리보기 배율" className="text-xs tabular-nums">
          {Math.round(scale * 100)}%
        </output>
        <button aria-label="축소" onClick={() => setScale(scale - 0.25)}>
          <ZoomOut size={18} />
        </button>
        <button
          aria-label="전체 화면"
          onClick={async () => {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await previewRef.current?.requestFullscreen?.();
          }}
        >
          <Expand size={17} />
        </button>
      </div>
      <div className="map-preview-caption" role="status">
        {emptyMessage ??
          (finding && !box
            ? "위치 정보가 없는 항목입니다. 상세 설명을 확인해주세요."
            : "드래그로 이동 · 번호를 선택하면 확대 및 설명")}
      </div>
    </div>
  );
}
