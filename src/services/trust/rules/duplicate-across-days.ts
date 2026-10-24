import type { TrustRule } from "./contract";

export const duplicateAcrossDaysRule: TrustRule = {
  code: "DUP_ACROSS_DAYS",
  scope: "trip",
  evaluate({ trip, evidenceFor, issue, placeFor }) {
    const issues = [];
    const dayPlaceIds = new Map<string, string>();
    for (const item of trip.items) {
      const priorDay = dayPlaceIds.get(item.placeId);
      if (priorDay && priorDay !== item.dayId) {
        issues.push(
          issue(
            {
              code: "DUP_ACROSS_DAYS",
              dayId: item.dayId,
              itemId: item.id,
              placeId: item.placeId,
              message: `地点「${placeFor(item)?.name ?? item.placeId}」跨天重复`,
              suggestion: "保留一次或换成其他候选地点",
              evidence: evidenceFor(item.placeId),
            },
            "warning",
          ),
        );
      } else {
        dayPlaceIds.set(item.placeId, item.dayId);
      }
    }
    return issues;
  },
};
