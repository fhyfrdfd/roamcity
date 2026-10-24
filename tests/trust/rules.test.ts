import { describe, expect, it } from "vitest";

import { allRules, dayRules, tripRules } from "@/services/trust";
import { chongqingTrip } from "@/data/demo/chongqing";
import { buildEvidenceCards } from "@/services/trust";
import { validateTripTrust } from "@/services/trust";

describe("trust rule registry", () => {
  it("registers every P0 rule exactly once", () => {
    const codes = allRules.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_PLACE",
        "DUP_ACROSS_DAYS",
        "MISSING_MEAL",
        "CLOSED_AT_ARRIVAL",
        "TRAVEL_TOO_LONG",
        "DAY_OVERLOADED",
        "BUDGET_EXCEEDED",
        "WALKING_LIMIT",
        "ACCESSIBILITY_RISK",
        "WEATHER_RISK",
        "UNVERIFIED_PLACE",
      ]),
    );
    expect(dayRules.every((rule) => rule.scope === "day")).toBe(true);
    expect(tripRules.every((rule) => rule.scope === "trip")).toBe(true);
  });

  it("composes the same validation report as the aggregate validator", () => {
    const trip = structuredClone(chongqingTrip);
    const evidence = buildEvidenceCards(trip);
    const report = validateTripTrust(trip, evidence, { now: new Date("2026-10-22T00:00:00.000Z") });
    expect(report.generatedAt).toBe("2026-10-22T00:00:00.000Z");
    expect(report.passed).toBe(report.issues.every((issue) => issue.severity !== "error"));
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});
