import { guidelineCategories } from "@/pages/support/guidelines";

const titles = new Map<string, string>(
  guidelineCategories.flatMap((category) => category.types.map((type) => [type.id, type.title])),
);

export function ruleTitle(ruleId: string) {
  return titles.get(ruleId) ?? ruleId;
}
