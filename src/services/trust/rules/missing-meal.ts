import { minutes } from "../heuristics";
import { itemsOfDay, type TrustRule } from "./contract";

export const missingMealRule: TrustRule = {
  code: "MISSING_MEAL",
  scope: "day",
  evaluate({ trip, issue, placeFor }, day) {
    if (!day) return [];
    const items = itemsOfDay(trip, day);
    const hasMeal = items.some((item) => {
      if (item.meal === "lunch" || item.meal === "dinner") return true;
      const currentPlace = placeFor(item);
      const start = minutes(item.startTime);
      return (
        currentPlace?.category === "food" &&
        ((start >= 11 * 60 && start < 15 * 60) || (start >= 17 * 60 && start < 22 * 60))
      );
    });
    if (hasMeal) return [];
    return [
      issue(
        {
          code: "MISSING_MEAL",
          dayId: day.id,
          message: `Day ${day.index + 1} 没有安排午餐或晚餐`,
          suggestion: "加入一个可验证的正餐地点",
        },
        "error",
      ),
    ];
  },
};
