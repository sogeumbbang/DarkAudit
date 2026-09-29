import type { AuditDto, BBoxDto } from "./types";
import { isFindingOnScreen } from "./findingScreens";

/** Number findings by their first screen, then top-to-bottom and left-to-right. */
export function orderFindings(audit: Pick<AuditDto, "screens" | "findings">) {
  const screens = [...audit.screens].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const positions = audit.findings.map((finding) => {
    const boxes = [
      finding.bbox,
      ...(finding.relatedElements ?? []).map((item) => item.bbox),
    ].filter((box): box is BBoxDto => Boolean(box));
    // A shared finding keeps one number wherever it reappears, including related regions.
    const screenIndex = screens.findIndex((screen) => isFindingOnScreen(finding, screen.id));
    const screen = screens[screenIndex];
    const coordinates = boxes
      .filter((box) => box.screenId === screen?.id)
      .map((box) => ({
        y: box.coordinateSystem === "normalized" ? box.y * (screen?.height || 1) : box.y,
        x: box.coordinateSystem === "normalized" ? box.x * (screen?.width || 1) : box.x,
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    return {
      finding,
      screen: screenIndex < 0 ? screens.length : screenIndex,
      // Findings without a location follow the located findings on the same screen.
      y: coordinates[0]?.y ?? Infinity,
      x: coordinates[0]?.x ?? Infinity,
    };
  });
  return positions
    .sort(
      (a, b) =>
        a.screen - b.screen || a.y - b.y || a.x - b.x || a.finding.id.localeCompare(b.finding.id),
    )
    .map(({ finding }) => finding);
}
