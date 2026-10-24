import { describe, expect, it } from "vitest";
import { buildTrustReplan } from "@/services/trust/replan";
import type { PlanningProfile } from "@/schemas/planning";
import type { Day, ItineraryItem, Place, Trip } from "@/types/travel";

function day(overrides: Partial<Day> = {}): Day {
  return {
    id: "d1",
    tripId: "t1",
    index: 0,
    date: "2030-05-01",
    title: "Day 1",
    summary: "",
    weather: { tempC: 24, condition: "晴", icon: "sun" },
    ...overrides,
  };
}

function place(id: string, name: string, overrides: Partial<Place> = {}): Place {
  return {
    id,
    name,
    category: "attraction",
    lat: 29.56,
    lng: 106.55,
    rating: 4.5,
    reviewCount: 50,
    image: "",
    priceLevel: 0,
    address: "",
    openingStatus: "open",
    stayMinutes: 60,
    description: "",
    tags: [],
    district: "",
    ...overrides,
  };
}

function item(id: string, placeId: string, order: number, overrides: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    id,
    dayId: "d1",
    type: "place",
    placeId,
    startTime: `${String(9 + order).padStart(2, "0")}:00`,
    duration: 60,
    order,
    status: "planned",
    ...overrides,
  };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  const places = overrides.places ?? [place("p-a", "人民大礼堂"), place("p-b", "解放碑")];
  const items = overrides.items ?? [
    item("it-1", "p-a", 0),
    item("it-2", "p-b", 1),
    item("it-3", "p-food", 2, { type: "food", startTime: "12:00", meal: "lunch" }),
  ];
  return {
    id: "t1",
    title: "测试行程",
    destination: "重庆",
    origin: "桂林",
    startDate: "2030-05-01",
    endDate: "2030-05-01",
    travelers: 2,
    budget: 2000,
    estimatedSpend: 500,
    coverImage: "",
    vibe: [],
    prompt: "",
    days: [day()],
    items,
    segments: [],
    places: places.some((candidate) => candidate.id === "p-food") ? places : [...places, place("p-food", "小面馆", { category: "food", estimatedCost: 25 })],
    hotels: [],
    restaurants: [],
    activities: [],
    transports: [],
    tasks: [],
    budgetItems: [],
    ...overrides,
  } as Trip;
}

describe("buildTrustReplan", () => {
  it("replaces a closed place with an open place already in the candidate pool", () => {
    const plan = buildTrustReplan(trip({
      places: [place("p-a", "人民大礼堂", { openingStatus: "closed" }), place("p-b", "解放碑"), place("p-alt", "三峡博物馆", { tags: ["室内"] })],
      items: [item("it-1", "p-a", 0), item("it-2", "p-b", 1), item("it-3", "p-food", 2, { type: "food", startTime: "12:00", meal: "lunch" })],
    }));

    expect(plan.actions).toContainEqual({ type: "REPLACE_ITEM", payload: { itemId: "it-1", placeId: "p-alt" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "replace", fromItemId: "it-1", toPlaceId: "p-alt", reason: "PLACE_CLOSED" }));
  });

  it("retimes the first stop when it starts before the opening window", () => {
    const plan = buildTrustReplan(trip({
      places: [place("p-a", "人民大礼堂", { openingHours: "10:00-18:00" }), place("p-b", "解放碑")],
      items: [item("it-1", "p-a", 0, { startTime: "09:00" }), item("it-2", "p-b", 1), item("it-3", "p-food", 2, { type: "food", startTime: "12:00", meal: "lunch" })],
    }));

    expect(plan.actions).toContainEqual({ type: "CHANGE_TIME", payload: { itemId: "it-1", startTime: "10:05" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "retime", fromItemId: "it-1", reason: "PLACE_CLOSED" }));
  });

  it("moves an outdoor stop indoors on a rainy day", () => {
    const plan = buildTrustReplan(trip({
      days: [day({ weather: { tempC: 19, condition: "中雨", icon: "rain" } })],
      places: [
        place("p-a", "江边步道", { tags: ["户外"] }),
        place("p-b", "解放碑"),
        place("p-indoor", "三峡博物馆", { category: "activity", tags: ["室内"] }),
      ],
    }));

    expect(plan.actions).toContainEqual({ type: "REPLACE_ITEM", payload: { itemId: "it-1", placeId: "p-indoor" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "replace", toPlaceId: "p-indoor", reason: "WEATHER" }));
  });

  it("adds a verified meal when the day has none", () => {
    const plan = buildTrustReplan(trip({
      places: [place("p-a", "人民大礼堂"), place("p-b", "解放碑"), place("p-c", "洪崖洞"), place("p-food", "小面馆", { category: "food", estimatedCost: 25 })],
      items: [item("it-1", "p-a", 0), item("it-2", "p-b", 1), item("it-3", "p-c", 2)],
    }));

    expect(plan.actions).toContainEqual({ type: "ADD_ITEM", payload: { placeId: "p-food", dayId: "d1", startTime: "12:00", durationMinutes: 60, meal: "lunch" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "add", toPlaceId: "p-food", reason: "USER_REQUEST" }));
  });

  it("deduplicates a same-day repeat with an unused candidate", () => {
    const plan = buildTrustReplan(trip({
      places: [place("p-a", "人民大礼堂"), place("p-b", "解放碑")],
      items: [item("it-1", "p-a", 0), item("it-2", "p-a", 1), item("it-3", "p-food", 2, { type: "food", startTime: "12:00", meal: "lunch" })],
    }));

    expect(plan.actions).toContainEqual({ type: "REPLACE_ITEM", payload: { itemId: "it-2", placeId: "p-b" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "replace", fromItemId: "it-2", toPlaceId: "p-b", reason: "USER_REQUEST" }));
  });

  it("removes a same-day duplicate when the pool has no alternative", () => {
    const plan = buildTrustReplan(trip({
      places: [place("p-a", "人民大礼堂")],
      items: [item("it-1", "p-a", 0), item("it-2", "p-a", 1), item("it-3", "p-food", 2, { type: "food", startTime: "12:00", meal: "lunch" })],
    }));

    expect(plan.actions).toContainEqual({ type: "REMOVE_ITEM", payload: { itemId: "it-2" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "remove", fromItemId: "it-2", reason: "USER_REQUEST" }));
  });

  it("attributes generic cleanups to the trigger reason when one is given", () => {
    const plan = buildTrustReplan(
      trip({
        places: [place("p-a", "人民大礼堂")],
        items: [item("it-1", "p-a", 0), item("it-2", "p-a", 1), item("it-3", "p-food", 2, { type: "food", startTime: "12:00", meal: "lunch" })],
      }),
      { reason: "CROWD" },
    );

    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "remove", fromItemId: "it-2", reason: "CROWD" }));
  });

  it("replaces a stairs/steep stop when accessibility is requested", () => {
    const plan = buildTrustReplan(
      trip({
        places: [
          place("p-a", "登山步道", { tags: ["户外", "登山"] }),
          place("p-b", "解放碑"),
          place("p-alt", "三峡博物馆", { tags: ["室内"] }),
        ],
        items: [item("it-1", "p-a", 0), item("it-2", "p-b", 1), item("it-3", "p-food", 2, { type: "food", startTime: "12:00", meal: "lunch" })],
      }),
      { profile: { accessibility: true } as PlanningProfile },
    );

    expect(plan.actions).toContainEqual({ type: "REPLACE_ITEM", payload: { itemId: "it-1", placeId: "p-alt" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "replace", fromItemId: "it-1", reason: "ACCESSIBILITY" }));
  });

  it("leaves unrepairable problems untouched rather than inventing places", () => {
    const plan = buildTrustReplan(trip({
      places: [place("p-a", "人民大礼堂", { openingStatus: "closed" }), place("p-b", "解放碑")],
    }));

    expect(plan.actions).toEqual([]);
    expect(plan.summary).toBe("没有可自动修复的问题");
  });

  it("reduces the planned allocation when the budget cap is exceeded", () => {
    const plan = buildTrustReplan(trip({
      budget: 100,
      estimatedSpend: 500,
      budgetItems: [{ id: "b-1", tripId: "t1", category: "food", label: "餐饮", planned: 500 }],
    }));

    expect(plan.actions).toContainEqual({ type: "REDUCE_BUDGET", payload: { amount: 400, reason: "超预算自动压缩" } });
    expect(plan.changes).toContainEqual(expect.objectContaining({ type: "budget", reason: "BUDGET" }));
  });

  it("is deterministic across repeated runs", () => {
    const input = trip({
      days: [day({ weather: { tempC: 19, condition: "中雨", icon: "rain" } })],
      places: [place("p-a", "江边步道", { tags: ["户外"] }), place("p-b", "解放碑"), place("p-indoor", "三峡博物馆", { category: "activity", tags: ["室内"] })],
    });
    expect(buildTrustReplan(input)).toEqual(buildTrustReplan(input));
  });
});
