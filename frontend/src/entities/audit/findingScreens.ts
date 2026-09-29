import type { FindingDto } from "./types";

/** Count a finding once per screen, including any related evidence on that screen. */
export function isFindingOnScreen(finding: FindingDto, screenId: string) {
  return (
    finding.screenIds.includes(screenId) ||
    finding.bbox?.screenId === screenId ||
    (finding.relatedElements ?? []).some(
      (element) => element.screenId === screenId || element.bbox?.screenId === screenId,
    )
  );
}
