import type { TrustRule } from "./contract";

export const walkingLimitRule: TrustRule = {
  code: "WALKING_LIMIT",
  scope: "trip",
  evaluate({ trip, profile, walkingMinutesByTolerance, issue }) {
    const tolerance = profile?.walkingTolerance;
    if (!tolerance) return [];
    const walkingMinutes = trip.segments
      .filter((segment) => segment.mode === "walk")
      .reduce((sum, segment) => sum + (segment.durationMinutes ?? segment.minutes), 0);
    const limit = walkingMinutesByTolerance[tolerance] ?? 150;
    if (walkingMinutes <= limit) return [];
    return [
      issue(
        {
          code: "WALKING_LIMIT",
          message: `步行约 ${Math.round(walkingMinutes)} 分钟，超过“${tolerance}”接受度`,
          suggestion: "改用公共交通或打车，并缩短相邻地点距离",
        },
        "warning",
      ),
    ];
  },
};
