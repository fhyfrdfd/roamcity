import type { TrustRule } from "./contract";

export const budgetExceededRule: TrustRule = {
  code: "BUDGET_EXCEEDED",
  scope: "trip",
  evaluate({ trip, issue }) {
    const planned = trip.budgetItems.reduce((sum, item) => sum + item.planned, 0) || trip.estimatedSpend;
    if (!(trip.budget > 0 && planned > trip.budget)) return [];
    return [
      issue(
        {
          code: "BUDGET_EXCEEDED",
          message: `预计花费 ¥${Math.round(planned)} 超过预算 ¥${Math.round(trip.budget)}`,
          suggestion: "替换低价地点或减少付费活动",
        },
        "error",
      ),
    ];
  },
};
