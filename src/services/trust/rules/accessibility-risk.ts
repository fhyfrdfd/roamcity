import { isAccessibilityRisk } from "../heuristics";
import { itemsOfDay, type TrustRule } from "./contract";

export const accessibilityRiskRule: TrustRule = {
  code: "ACCESSIBILITY_RISK",
  scope: "day",
  evaluate({ trip, accessibilityRequested, evidenceFor, issue, placeFor }, day) {
    if (!day || !accessibilityRequested) return [];
    const issues = [];
    for (const item of itemsOfDay(trip, day)) {
      const currentPlace = placeFor(item);
      if (currentPlace && isAccessibilityRisk(currentPlace)) {
        issues.push(
          issue(
            {
              code: "ACCESSIBILITY_RISK",
              dayId: day.id,
              itemId: item.id,
              placeId: item.placeId,
              message: `无障碍需求下「${currentPlace.name}」存在台阶、爬坡或无电梯风险`,
              suggestion: "替换为无障碍友好的室内地点或安排接送",
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
