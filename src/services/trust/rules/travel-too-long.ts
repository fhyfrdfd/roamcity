import type { TrustRule } from "./contract";

export const travelTooLongRule: TrustRule = {
  code: "TRAVEL_TOO_LONG",
  scope: "trip",
  evaluate({ trip, maxTravelMinutes, issue }) {
    const issues = [];
    for (const segment of trip.segments) {
      const duration = segment.durationMinutes ?? segment.minutes;
      if (duration > maxTravelMinutes) {
        issues.push(
          issue(
            {
              code: "TRAVEL_TOO_LONG",
              dayId: segment.dayId,
              itemId: segment.toItemId,
              placeId: segment.toPlaceId,
              message: `相邻地点交通约 ${Math.round(duration)} 分钟，超过上限 ${maxTravelMinutes} 分钟`,
              suggestion: "按地理位置重排或替换就近地点",
            },
            "error",
          ),
        );
      }
    }
    return issues;
  },
};
