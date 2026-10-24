// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import type { Place } from "@/types/travel";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";

vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Place[];
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { query: string; category?: Place["category"]; limit: number }) {
    return this.fixture.places
      .filter((candidate) => !input.category || candidate.category === input.category)
      .slice(0, input.limit)
      .map((candidate) => ({ ...candidate, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } }));
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

describe("propose-trust-replan runtime command", () => {
  let dataDir: string;
  let repository: JsonSkillRepository;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-trust-replan-"));
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => new RealFixtureProvider(fixture));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function create() {
    return runtime.createTrip({
      origin: "桂林", destination: "重庆", startDate: "2030-05-01", days: 3, people: 2, budget: 2500,
      preferences: [], walkingTolerance: "low", fallbackPolicy: "estimated",
    }) as any;
  }

  it("rejects a stale revision before creating a proposal", async () => {
    const created = await create();
    await expect(runtime.proposeTrustReplan({ tripId: created.data.tripId, expectedTripRevision: 999 })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });

  it("proposes a confirmed replacement for a closed place and applies it as a new revision", async () => {
    const created = await create();
    const tripId = created.data.tripId as string;
    const stored = await repository.getTrip(tripId);
    expect(stored).not.toBeNull();
    if (!stored) return;

    const usedAttraction = stored.trip.items
      .map((item) => stored.trip.places.find((place) => place.id === item.placeId))
      .find((place) => place?.category === "attraction");
    expect(usedAttraction).toBeTruthy();
    if (!usedAttraction) return;

    const closed = await repository.updateTrip({
      tripId,
      expectedRevision: stored.revision,
      trip: {
        ...stored.trip,
        places: stored.trip.places.map((place) => place.id === usedAttraction.id ? { ...place, openingStatus: "closed" as const } : place),
      },
    });

    const proposed = await runtime.proposeTrustReplan({ tripId, expectedTripRevision: closed.revision }) as any;
    expect(proposed.ok).toBe(true);
    expect(proposed.data.proposalId).toBeTruthy();
    expect(proposed.data.proposalToken).toBeTruthy();
    expect(proposed.data.requiresConfirmation).toBe(true);
    expect(proposed.data.trustChanges).toContainEqual(expect.objectContaining({ reason: "PLACE_CLOSED" }));

    // Nothing is written until the human confirms the diff.
    const beforeApply = await runtime.getTrip({ tripId }) as any;
    expect(beforeApply.data.revision).toBe(closed.revision);
    expect(beforeApply.data.trip.places.find((place: Place) => place.id === usedAttraction.id).openingStatus).toBe("closed");

    const applied = await runtime.applyChange({
      tripId,
      proposalId: proposed.data.proposalId,
      expectedTripRevision: proposed.data.baseRevision,
      confirmed: true,
      proposalToken: proposed.data.proposalToken,
    }) as any;
    expect(applied.data.revision).toBe(proposed.data.baseRevision + 1);
    const closedIssues = applied.data.trip.trust.validation.issues.filter((issue: { code: string }) => issue.code === "CLOSED_AT_ARRIVAL");
    expect(closedIssues).toEqual([]);
  });

  it("returns no proposal when the trip has nothing it can repair", async () => {
    const created = await create();
    const tripId = created.data.tripId as string;
    const stored = await repository.getTrip(tripId);
    expect(stored).not.toBeNull();
    if (!stored) return;
    // Remove every issue the planner knows how to fix by making all places
    // open, indoor and cheap, then ask again.
    const clean = await repository.updateTrip({
      tripId,
      expectedRevision: stored.revision,
      trip: {
        ...stored.trip,
        budget: 0,
        days: stored.trip.days.map((day) => ({ ...day, weather: { ...day.weather, condition: "晴", icon: "sun" as const } })),
        places: stored.trip.places.map((place) => ({
          ...place,
          openingStatus: "open" as const,
          openingHours: "00:00-23:59",
          estimatedCost: 0,
          tags: [...place.tags.filter((tag) => !/户外/.test(tag)), "室内"],
        })),
      },
    });
    const proposed = await runtime.proposeTrustReplan({ tripId, expectedTripRevision: clean.revision }) as any;
    expect(proposed.ok).toBe(true);
    expect(proposed.data.proposalId).toBeNull();
    expect(proposed.data.summary).toBeTruthy();
  });
});
