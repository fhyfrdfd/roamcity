import type { ItineraryItem, Place, RouteSegment, Trip } from "@/types/travel";
import type { EvidenceCard } from "@/schemas/trust";

function sourceFor(place: Place): EvidenceCard["source"] {
  if (place.provenance?.estimated === true || place.source === "demo") return "demo";
  if (place.provenance?.source === "amap" || place.source === "amap") return "amap";
  return "manual";
}

function confidenceFor(place: Place) {
  if (sourceFor(place) === "amap") return 0.9;
  if (sourceFor(place) === "demo") return 0.6;
  if (place.source === "user") return 0.45;
  return 0.25;
}

function whyChosen(place: Place) {
  const facts = [
    place.category === "food" ? "类别为美食" : undefined,
    place.district || place.address ? `位于${place.district || place.address}` : undefined,
    place.rating > 0 ? `评分 ${place.rating.toFixed(1)}` : undefined,
    place.openingHours ? `营业时间 ${place.openingHours}` : undefined,
  ].filter(Boolean);
  return facts.length ? facts.join("，") : "来自当前候选地点集合";
}

function segmentFor(trip: Trip, item: ItineraryItem): RouteSegment | undefined {
  return trip.segments.find((segment) => segment.toItemId === item.id && segment.dayId === item.dayId);
}

export function buildEvidenceCards(trip: Trip, fetchedAt = new Date().toISOString()): EvidenceCard[] {
  const items = [...trip.items].sort((a, b) => a.dayId.localeCompare(b.dayId) || a.order - b.order);
  return items.flatMap((item) => {
    const place = trip.places.find((candidate) => candidate.id === item.placeId);
    if (!place) return [];
    const segment = segmentFor(trip, item);
    const source = sourceFor(place);
    return [{
      placeId: place.id,
      name: place.name,
      source,
      ...(place.sourceId ? { sourceId: place.sourceId } : {}),
      fetchedAt,
      real: source === "amap" || source === "official",
      ...(place.openingHours ? { openingHours: place.openingHours } : {}),
      ...(place.estimatedCost !== undefined ? { price: place.estimatedCost } : {}),
      ...(place.rating > 0 ? { rating: place.rating } : {}),
      ...(place.address ? { address: place.address } : {}),
      ...(segment ? {
        distanceFromPreviousM: segment.distanceMeters ?? segment.meters,
        travelMinutesFromPrevious: segment.durationMinutes ?? segment.minutes,
      } : {}),
      confidence: confidenceFor(place),
      whyChosen: whyChosen(place),
    } satisfies EvidenceCard];
  });
}
