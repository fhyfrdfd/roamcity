import { itemsOfDay, type TrustRule } from "./contract";

export const dayOverloadedRule: TrustRule = {
  code: "DAY_OVERLOADED",
  scope: "day",
  evaluate({ trip, issue }, day) {
    if (!day) return [];
    const items = itemsOfDay(trip, day);
    const dayDuration =
      items.reduce((total, item) => total + item.duration, 0) +
      trip.segments
        .filter((segment) => segment.dayId === day.id)
        .reduce((total, segment) => total + (segment.durationMinutes ?? segment.minutes), 0);
    if (items.length <= 4 && dayDuration <= 8 * 60) return [];
    return [
      issue(
        {
          code: "DAY_OVERLOADED",
          dayId: day.id,
          message: `Day ${day.index + 1} 安排过密（${items.length} 个 stop，约 ${Math.round(dayDuration / 60)} 小时）`,
          suggestion: "拆分地点或留出更多缓冲",
        },
        "warning",
      ),
    ];
  },
};
