import { itemsOfDay, type TrustRule } from "./contract";

export const tooFewStopsRule: TrustRule = {
  code: "TOO_FEW_STOPS",
  scope: "day",
  evaluate({ trip, issue }, day) {
    if (!day) return [];
    const items = itemsOfDay(trip, day);
    if (items.length >= 3) return [];
    return [
      issue(
        {
          code: "TOO_FEW_STOPS",
          dayId: day.id,
          message: `Day ${day.index + 1} 只有 ${items.length} 个 stop，未达到至少 3 个的目标`,
          suggestion: "若候选地点充足，可加入经过去重和来源核验的地点",
        },
        "warning",
      ),
    ];
  },
};
