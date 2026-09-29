import { useState } from "react";

import type { AuditScreenDto, BBoxDto, FindingDto } from "@/entities/audit/types";

type NumberedFinding = { finding: FindingDto; number: number };

function relativeBox(bbox: BBoxDto, width: number, height: number) {
  const normalized = bbox.coordinateSystem === "normalized";
  const x = normalized ? bbox.x : bbox.x / width;
  const y = normalized ? bbox.y : bbox.y / height;
  const w = normalized ? bbox.width : bbox.width / width;
  const h = normalized ? bbox.height : bbox.height / height;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(1, x + w);
  const bottom = Math.min(1, y + h);
  if (right <= left || bottom <= top) return null;
  return { x: left * 100, y: top * 100, width: (right - left) * 100, height: (bottom - top) * 100 };
}

/** Percentage overlays resize with the image in both preview and paged print layout. */
export function ReportScreen({
  screen,
  findings,
}: {
  screen: AuditScreenDto;
  findings: NumberedFinding[];
}) {
  const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null);
  const width = screen.width || loaded?.width || 0;
  const height = screen.height || loaded?.height || 0;
  const imageWidth = loaded?.width || width;
  const imageHeight = loaded?.height || height;
  const highlights = findings.flatMap(({ finding, number }) => {
    const boxes: { bbox: BBoxDto; related: boolean }[] = [];
    if (finding.bbox?.screenId === screen.id) boxes.push({ bbox: finding.bbox, related: false });
    for (const element of finding.relatedElements ?? []) {
      if (element.bbox?.screenId === screen.id) boxes.push({ bbox: element.bbox, related: true });
    }
    return boxes.flatMap(({ bbox, related }, index) => {
      const box = relativeBox(bbox, width, height);
      return box
        ? [{ ...box, related, number, title: finding.title, key: `${finding.id}-${index}` }]
        : [];
    });
  });

  return (
    <>
      <div
        className="audit-report-image-frame"
        style={
          imageWidth && imageHeight
            ? { width: `min(100%, ${(190 * imageWidth) / imageHeight}mm)` }
            : undefined
        }
      >
        <img
          src={screen.imageUrl}
          alt={`${screen.flowStep} 분석 대상 화면`}
          onLoad={(event) =>
            setLoaded({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
        {highlights.length > 0 && (
          <div className="audit-report-annotations" role="group" aria-label="문제 위치 표시">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {highlights.map((box) => (
                <rect
                  key={box.key}
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={box.related ? "5 3" : undefined}
                />
              ))}
            </svg>
            {highlights.map((box) => (
              <span
                className="audit-report-annotation-number"
                key={box.key}
                aria-label={`${box.number}. ${box.title} ${box.related ? "관련 영역" : "탐지 영역"}`}
                style={{
                  left: `${Math.min(box.x, 90)}%`,
                  top: `${box.y}%`,
                  transform: box.y >= 4 ? "translateY(-100%)" : undefined,
                }}
              >
                {box.number}
              </span>
            ))}
          </div>
        )}
      </div>
      {findings.length > 0 && (
        <div className="audit-report-image-legend">
          {highlights.length > 0 && (
            <p>번호는 오른쪽 탐지 항목과 대응합니다. 실선: 탐지 영역 · 점선: 관련 영역</p>
          )}
          {findings
            .filter(({ number }) => !highlights.some((box) => box.number === number))
            .map(({ finding, number }) => (
              <p key={finding.id}>
                {number}. {finding.title}: 위치 좌표가 없어 영역을 표시하지 않았습니다.
              </p>
            ))}
        </div>
      )}
    </>
  );
}
