import { getPlaceInputSchema, successEnvelope, updateTripInputSchema } from "@/skill/contracts";
import { normalizeProviderError, SkillError } from "@/skill/errors";
import type { JsonSkillRepository } from "@/skill/repository";
import type { TravelDataProvider } from "@/skill/providers";
import { placeLevel, status, uniquePlaces } from "@/skill/runtime-helpers";
import { estimateBudgetItems } from "@/services/ai/actions/executor";
import type { Trip } from "@/types/travel";

export interface TripCommandDeps {
  repository: Pick<JsonSkillRepository, "getTrip" | "updateTrip">;
  providerFactory: () => Promise<TravelDataProvider>;
}

export async function getPlaceCommand(raw: unknown, deps: TripCommandDeps) {
  const input = getPlaceInputSchema.parse(raw);
  if (input.tripId && input.placeId) {
    const stored = await deps.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    const place = stored.trip.places.find((candidate) => candidate.id === input.placeId);
    if (!place) throw new SkillError("PLACE_NOT_FOUND", "Place not found in trip");
    return successEnvelope({ place, matchBasis: "trip_lookup" as const }, status("UNKNOWN", "UNKNOWN", "UNKNOWN"));
  }
  const provider = await deps.providerFactory();
  const places = uniquePlaces(await provider.searchPlaces({ destination: input.city!, query: input.name!, category: undefined, limit: 5 }).catch((error) => {
    throw normalizeProviderError(error, "NO_POI_RESULTS");
  }));
  if (!places.length) throw new SkillError("NO_POI_RESULTS", "No matching places found");
  const name = input.name!.trim();
  const best = places.find((place) => place.name === name)
    ?? places.find((place) => place.name.includes(name) || name.includes(place.name))
    ?? places[0];
  return successEnvelope({ place: best, matchBasis: "provider_search" as const }, status(placeLevel(provider), "UNKNOWN", "UNKNOWN"));
}

export async function updateTripCommand(raw: unknown, deps: TripCommandDeps) {
  const input = updateTripInputSchema.parse(raw);
  const stored = await deps.repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
  const { patch } = input;
  let trip: Trip = { ...stored.trip, ...patch, updatedAt: new Date().toISOString() };
  if (patch.budget !== undefined) {
    trip = estimateBudgetItems({ ...trip, estimatedSpend: Math.round(patch.budget * 0.85) });
  }
  const saved = await deps.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
  return successEnvelope(
    { tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash, changedFields: Object.keys(patch) },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    [],
    { source: "user_patch" },
  );
}
