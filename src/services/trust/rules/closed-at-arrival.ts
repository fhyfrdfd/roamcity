import { minutes, openingRange } from "../heuristics";
import { itemsOfDay, type TrustRule } from "./contract";

export const closedAtArrivalRule: TrustRule = {
  code: "CLOSED_AT_ARRIVAL",
  scope: "day",
  evaluate({ trip, evidenceFor, issue, placeFor }, day) {
    if (!day) return [];
    const issues = [];
    for (const item of itemsOfDay(trip, day)) {
      const currentPlace = placeFor(item);
      if (currentPlace?.openingStatus === "closed") {
        issues.push(
          issue(
            {
              code: "CLOSED_AT_ARRIVAL",
              dayId: day.id,
              itemId: item.id,
              placeId: item.placeId,
              message: `「${currentPlace.name}」当前标记为 closed`,
              suggestion: "调整时间或替换地点",
              evidence: evidenceFor(item.placeId),
            },
            "error",
          ),
        );
      }
      const range = openingRange(currentPlace?.openingHours);
      if (range && (minutes(item.startTime) < range.start || minutes(item.startTime) > range.end)) {
        issues.push(
          issue(
            {
              code: "CLOSED_AT_ARRIVAL",
              dayId: day.id,
              itemId: item.id,
              placeId: item.placeId,
              message: `「${currentPlace?.name ?? item.placeId}」到达时间不在营业时间内`,
              suggestion: "调整开始时间或替换地点",
              evidence: evidenceFor(item.placeId),
            },
            "error",
          ),
        );
      }
    }
    return issues;
  },
};
