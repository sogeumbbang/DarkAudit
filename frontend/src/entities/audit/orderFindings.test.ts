import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import type { AuditScreenDto, FindingDto } from "./types";
import { orderFindings } from "./orderFindings";

const screens: AuditScreenDto[] = [2, 1].map((order) => ({
  id: "screen-" + order,
  order,
  flowStep: "화면 " + order,
  imageUrl: "",
  findingCount: 0,
  width: 400,
  height: 1000,
}));

function finding(id: string, screenId: string, y?: number, x = 0): FindingDto {
  return {
    ...dashboardFixture.audits[0]!.findings[0]!,
    id,
    screenIds: [screenId],
    bbox:
      y === undefined ? null : { screenId, x, y, width: 20, height: 20, coordinateSystem: "image" },
  };
}

it("orders shuffled results by screen, vertical position, then horizontal position", () => {
  const findings = [
    finding("later-screen", "screen-2", 0),
    finding("right", "screen-1", 100, 100),
    finding("lower", "screen-1", 500),
    finding("left", "screen-1", 100, 10),
  ];
  const before = [...findings];
  expect(orderFindings({ screens, findings }).map((item) => item.id)).toEqual([
    "left",
    "right",
    "lower",
    "later-screen",
  ]);
  expect(findings).toEqual(before);
  expect(screens[0]!.order).toBe(2);
});

it("uses the first related screen and compares normalized and pixel coordinates", () => {
  const shared = finding("shared", "screen-2", 10);
  shared.screenIds = ["screen-2", "screen-1"];
  shared.relatedElements = [
    {
      screenId: "screen-1",
      description: "이전 화면의 관련 요소",
      bbox: {
        screenId: "screen-1",
        x: 0.1,
        y: 0.6,
        width: 0.1,
        height: 0.1,
        coordinateSystem: "normalized",
      },
    },
  ];
  const findings = [shared, finding("early", "screen-1", 100), finding("late", "screen-1", 900)];
  expect(orderFindings({ screens, findings }).map((item) => item.id)).toEqual([
    "early",
    "shared",
    "late",
  ]);
});

it("places missing positions last per screen and keeps ties stable across responses and status changes", () => {
  const findings = [
    finding("unknown-screen", "missing"),
    finding("no-position", "screen-1"),
    finding("b", "screen-1", 100),
    finding("a", "screen-1", 100),
    finding("next-screen", "screen-2", 0),
  ];
  const expected = ["a", "b", "no-position", "next-screen", "unknown-screen"];
  expect(orderFindings({ screens, findings }).map((item) => item.id)).toEqual(expected);
  const reordered = [...findings]
    .reverse()
    .map((item) => ({ ...item, status: "resolved" as const }));
  expect(orderFindings({ screens, findings: reordered }).map((item) => item.id)).toEqual(expected);
});
