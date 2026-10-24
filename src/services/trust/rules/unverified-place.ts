import type { TrustRule } from "./contract";

export const unverifiedPlaceRule: TrustRule = {
  code: "UNVERIFIED_PLACE",
  scope: "trip",
  evaluate({ evidence, issue }) {
    return evidence
      .filter((card) => !card.real)
      .map((card) =>
        issue(
          {
            code: "UNVERIFIED_PLACE",
            placeId: card.placeId,
            message: `「${card.name}」不是实时高德或官方数据`,
            suggestion: "在出发前重新核验地点信息",
            evidence: [card],
          },
          "warning",
        ),
      );
  },
};
