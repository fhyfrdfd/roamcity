import { isOutdoorPlace } from "../heuristics";
import { itemsOfDay, type TrustRule } from "./contract";

export const weatherRiskRule: TrustRule = {
  code: "WEATHER_RISK",
  scope: "day",
  evaluate({ trip, evidenceFor, issue, placeFor }, day) {
    if (!day) return [];
    if (!/雨|暴雨|雷|高温|酷热/.test(day.weather.condition)) return [];
    const issues = [];
    for (const item of itemsOfDay(trip, day)) {
      const currentPlace = placeFor(item);
      if (currentPlace && isOutdoorPlace(currentPlace)) {
        issues.push(
          issue(
            {
              code: "WEATHER_RISK",
              dayId: day.id,
              itemId: item.id,
              placeId: item.placeId,
              message: `天气为${day.weather.condition}，但安排了户外地点「${currentPlace.name}」`,
              suggestion: "替换为室内地点或准备雨具",
              evidence: evidenceFor(item.placeId),
            },
            "warning",
          ),
        );
      }
    }
    return issues;
  },
};
