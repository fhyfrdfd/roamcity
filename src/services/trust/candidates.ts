import type { Place, PlaceCategory } from "@/types/travel";
import { haversineMeters } from "@/lib/utils";

export interface CandidateQuery {
  city?: string;
  categories: PlaceCategory[];
  vibes?: string[];
  maxTravelMinutes?: number;
  budget?: number;
  walkingTolerance?: "low" | "medium" | "high";
  elderly?: boolean;
  accessibility?: boolean;
  limitPerCategory?: number;
}

export interface CandidateSet {
  places: Place[];
  byCategory: Partial<Record<PlaceCategory, Place[]>>;
  deduped: number;
  rejected: Array<{ placeId: string; reason: string }>;
}

function normalizedName(name: string) {
  return name.toLocaleLowerCase().replace(/[\s·•、，。,.!?！？()（）「」【】\[\]_-]+/g, "");
}

function quality(place: Place, vibes: string[]) {
  const haystack = [place.name, place.description, place.district, ...place.tags].join(" ").toLocaleLowerCase();
  const vibeHits = vibes.filter((vibe) => haystack.includes(vibe.toLocaleLowerCase())).length;
  const realBonus = place.provenance?.source === "amap" || place.source === "amap" ? 2 : 0;
  return realBonus + vibeHits + place.rating / 5 + (place.reviewCount > 0 ? 0.25 : 0);
}

/** Deduplicates provider output and keeps the richer record for each POI. */
export function buildCandidateSet(places: Place[], query: CandidateQuery): CandidateSet {
  const rejected: CandidateSet["rejected"] = [];
  let validCount = 0;
  const byKey = new Map<string, Place>();
  const sourceKeys = new Map<string, string>();
  const nameKeys = new Map<string, string>();
  for (const place of places) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      rejected.push({ placeId: place.id, reason: "坐标无效" });
      continue;
    }
    validCount += 1;
    const sourceKey = place.sourceId ? `source:${place.sourceId}` : undefined;
    const nameKey = `name:${normalizedName(place.name)}`;
    const key = (sourceKey && sourceKeys.get(sourceKey)) || nameKeys.get(nameKey) || sourceKey || nameKey;
    const current = byKey.get(key);
    if (!current || quality(place, query.vibes ?? []) > quality(current, query.vibes ?? [])) byKey.set(key, place);
    if (sourceKey) sourceKeys.set(sourceKey, key);
    nameKeys.set(nameKey, key);
  }

  const allowed = query.categories.length ? new Set(query.categories) : undefined;
  const ranked = [...byKey.values()]
    .filter((place) => !allowed || allowed.has(place.category))
    .sort((a, b) => quality(b, query.vibes ?? []) - quality(a, query.vibes ?? []));
  const limit = query.limitPerCategory;
  const categoryCounts = new Map<PlaceCategory, number>();
  const selected = ranked.filter((place) => {
    const count = categoryCounts.get(place.category) ?? 0;
    if (limit !== undefined && count >= limit) return false;
    categoryCounts.set(place.category, count + 1);
    return true;
  });
  // Seed with the strongest candidate, then keep nearby candidates adjacent so
  // the planner receives a geographically coherent pool rather than category batches.
  const geographic: Place[] = [];
  const remaining = new Set(selected);
  while (remaining.size) {
    const anchor = geographic.at(-1);
    const next = anchor
      ? [...remaining].sort((a, b) => haversineMeters(anchor, a) - haversineMeters(anchor, b) || quality(b, query.vibes ?? []) - quality(a, query.vibes ?? []))[0]
      : selected[0];
    if (!next) break;
    geographic.push(next);
    remaining.delete(next);
  }
  const byCategory: CandidateSet["byCategory"] = {};
  for (const place of geographic) (byCategory[place.category] ??= []).push(place);
  return { places: geographic, byCategory, deduped: validCount - byKey.size, rejected };
}
