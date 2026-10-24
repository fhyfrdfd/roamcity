import { describe, expect, it } from "vitest";
import { buildCandidateSet } from "@/services/trust/candidates";
import { buildEvidenceCards } from "@/services/trust/evidence";
import { validateTripTrust } from "@/services/trust/validator";
import { repairOutlineForTrust } from "@/services/trust/repair";
import type { PlanningProfile } from "@/schemas/planning";
import type { Place, Trip } from "@/types/travel";

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: "p-1", name: "测试景点", category: "attraction", lat: 29.5, lng: 106.5,
    rating: 4.5, reviewCount: 100, image: "", priceLevel: 1, address: "测试地址",
    openingStatus: "open", stayMinutes: 60, description: "室内展览", tags: ["文化"], district: "渝中区",
    source: "amap", sourceId: "amap-1", provenance: { source: "amap", estimated: false }, ...overrides,
  };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  const p = place();
  return {
    id: "trip-1", title: "测试", destination: "重庆", origin: "重庆", startDate: "2026-10-20", endDate: "2026-10-20",
    travelers: 2, budget: 1000, estimatedSpend: 200, coverImage: "", vibe: [], prompt: "", days: [{ id: "day-1", tripId: "trip-1", index: 0, date: "2026-10-20", title: "Day 1", summary: "", weather: { tempC: 20, condition: "晴", icon: "sun" } }],
    items: [{ id: "item-1", dayId: "day-1", type: "place", placeId: p.id, startTime: "09:00", duration: 60, order: 0, status: "planned" }],
    segments: [], places: [p], hotels: [], restaurants: [], activities: [], transports: [], tasks: [], budgetItems: [], ...overrides,
  };
}

describe("trust pipeline", () => {
  it("deduplicates by provider source id and caps each category", () => {
    const result = buildCandidateSet([place(), place({ id: "p-duplicate", name: "同名副本", rating: 3 }), place({ id: "p-food", name: "测试餐厅", category: "food", sourceId: "food-1" })], { categories: ["attraction", "food"], limitPerCategory: 1 });
    expect(result.places).toHaveLength(2);
    expect(result.deduped).toBe(1);
    expect(result.byCategory.food).toHaveLength(1);
  });

  it("builds factual evidence with provider provenance", () => {
    const cards = buildEvidenceCards(trip());
    expect(cards[0]).toMatchObject({ placeId: "p-1", source: "amap", real: true, confidence: 0.9 });
    expect(cards[0].whyChosen).toContain("评分");
  });

  it("reports duplicate, missing meal and long travel as hard issues", () => {
    const second = { id: "item-2", dayId: "day-1", type: "place" as const, placeId: "p-1", startTime: "11:00", duration: 60, order: 1, status: "planned" as const };
    const result = validateTripTrust(trip({ items: [trip().items[0], second], segments: [{ id: "seg-1", dayId: "day-1", fromItemId: "item-1", toItemId: "item-2", fromPlaceId: "p-1", toPlaceId: "p-1", mode: "walk", distanceMeters: 1000, durationMinutes: 90, meters: 1000, minutes: 90, label: "估算", provider: "haversine", estimated: true, updatedAt: "2026-10-20T00:00:00Z" }] }), buildEvidenceCards(trip()));
    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["DUPLICATE_PLACE", "MISSING_MEAL", "TRAVEL_TOO_LONG"]));
  });

  it("flags stairs/steep places only when accessibility is requested", () => {
    const risky = place({ id: "p-stairs", name: "登山步道", tags: ["户外", "登山"] });
    const riskyTrip = trip({
      places: [risky],
      items: [{ id: "item-1", dayId: "day-1", type: "place", placeId: "p-stairs", startTime: "09:00", duration: 60, order: 0, status: "planned" }],
    });
    const profile = { accessibility: true } as PlanningProfile;
    const withNeeds = validateTripTrust(riskyTrip, buildEvidenceCards(riskyTrip), { profile });
    expect(withNeeds.issues).toContainEqual(expect.objectContaining({ code: "ACCESSIBILITY_RISK", severity: "warning", placeId: "p-stairs" }));
    const withoutNeeds = validateTripTrust(riskyTrip, buildEvidenceCards(riskyTrip));
    expect(withoutNeeds.issues.some((issue) => issue.code === "ACCESSIBILITY_RISK")).toBe(false);
  });

  it("removes repeated stops and fills meal/stop gaps only with known candidates", () => {
    const candidates = [place(), place({ id: "p-2", sourceId: "amap-2", name: "景点二" }), place({ id: "p-3", sourceId: "amap-3", name: "景点三", rating: 4.2 }), place({ id: "p-food", sourceId: "amap-food", name: "午餐店", category: "food" })];
    const repaired = repairOutlineForTrust({ title: "测试", tasks: [], dayPlans: [
      { title: "Day 1", summary: "", stops: [{ placeId: "p-1", startTime: "09:00", durationMinutes: 60 }, { placeId: "p-1", startTime: "11:00", durationMinutes: 60 }] },
    ] }, candidates);
    expect(new Set(repaired.outline.dayPlans[0].stops.map((stop) => stop.placeId)).size).toBe(repaired.outline.dayPlans[0].stops.length);
    expect(repaired.outline.dayPlans[0].stops).toHaveLength(3);
    expect(repaired.outline.dayPlans[0].stops.some((stop) => stop.meal === "lunch" || stop.meal === "dinner")).toBe(true);
  });
});
