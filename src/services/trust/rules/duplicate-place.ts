import type { ItineraryItem } from "@/types/travel";
import { itemsOfDay, type TrustRule } from "./contract";

export const duplicatePlaceRule: TrustRule = {
  code: "DUPLICATE_PLACE",
  scope: "day",
  evaluate({ trip, evidenceFor, issue, placeFor }, day) {
    if (!day) return [];
    const issues = [];
    const seen = new Map<string, ItineraryItem>();
    for (const item of itemsOfDay(trip, day)) {
      const previous = seen.get(item.placeId);
      if (previous) {
        issues.push(
          issue(
            {
              code: "DUPLICATE_PLACE",
              dayId: day.id,
              itemId: item.id,
              placeId: item.placeId,
              message: `「${placeFor(item)?.name ?? item.placeId}」在同一天重复出现`,
              suggestion: "替换或移除重复地点",
              evidence: evidenceFor(item.placeId),
            },
            "error",
          ),
        );
      } else {
        seen.set(item.placeId, item);
      }
    }
    return issues;
  },
};
