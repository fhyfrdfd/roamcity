/**
 * Stateless helpers shared by the runtime command handlers and the extracted
 * planning services (create-trip / replan-trip). Nothing here touches the
 * repository or any runtime instance state.
 */
import { createHash } from "node:crypto";
import { haversineMeters, estimateTransit } from "@/lib/utils";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import { buildCandidateSet } from "@/services/trust";
import { createTikHubProvider } from "@/services/social/tikhub";
import { extractSocialSignals } from "@/services/social/signal-extractor";
import { resolveSourceLink } from "@/services/social/source-link";
import { SocialProviderRouter } from "@/services/social/router";
import { logger } from "@/lib/logger";
import type { PlanningProfile } from "@/schemas/planning";
import type { SocialEvidence, SocialObservation, SocialPlatform, SocialProviderStatus } from "@/services/social/types";
import type { TransportContext } from "@/types/transport-intelligence";
import type { ItineraryItem, Place, RouteSegment, Trip } from "@/types/travel";
import type { ProviderLevel, ProviderStatus } from "./contracts";
import { normalizeProviderError, SkillError } from "./errors";
import type { ProviderRoute, TravelDataProvider } from "./providers";

const DAY_MS = 86_400_000;

export function endDate(startDate: string, days: number) {
  return new Date(new Date(`${startDate}T12:00:00Z`).getTime() + (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(startDate: string, finishDate: string) {
  return Math.max(1, Math.min(7, Math.floor((new Date(`${finishDate}T12:00:00Z`).getTime() - new Date(`${startDate}T12:00:00Z`).getTime()) / DAY_MS) + 1));
}

export function preferredRouteMode(profile?: PlanningProfile): "walk" | "metro" | "bus" | "taxi" | "drive" | undefined {
  switch (profile?.transportPreference) {
    case "walk": return "walk";
    case "metro": return "metro";
    case "bus": return "bus";
    case "taxi": return "taxi";
    case "drive": return "drive";
    case "public": return "metro";
    default: return undefined;
  }
}

export function placeMatchesTerm(place: Place, term: string) {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return false;
  return [place.name, place.address, place.district, place.description, ...place.tags]
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle);
}

export function planningConstraintWarnings(profile: PlanningProfile | undefined, providerCandidates: Place[], selectedCandidates: Place[]) {
  if (!profile) return [];
  const warnings: string[] = [];
  const unmatchedMust = profile.mustVisit.filter((term) => !providerCandidates.some((place) => placeMatchesTerm(place, term)));
  if (unmatchedMust.length) warnings.push(`未能在 provider 候选中匹配必去地点：${unmatchedMust.join("、")}`);
  const matchedAvoid = profile.avoid.filter((term) => providerCandidates.some((place) => placeMatchesTerm(place, term)));
  if (matchedAvoid.length && selectedCandidates.some((place) => matchedAvoid.some((term) => placeMatchesTerm(place, term)))) {
    warnings.push("部分避开条件未能从候选地点元数据中完全排除");
  }
  if (profile.dietary.length && !providerCandidates.some((place) => profile.dietary.some((term) => placeMatchesTerm(place, term)))) {
    warnings.push(`provider 未提供可验证的饮食匹配：${profile.dietary.join("、")}`);
  }
  if (profile.accessibility !== undefined && !providerCandidates.some((place) => /无障碍|轮椅|电梯|accessible|elevator/i.test([place.name, place.description, ...place.tags].join(" ")))) {
    warnings.push("provider 未提供可验证的无障碍设施信息");
  }
  if (!selectedCandidates.length) warnings.push("旅行画像过滤后没有可用的 provider 候选，未生成地点替代品");
  return warnings;
}

export function overall(levels: ProviderLevel[]): ProviderLevel {
  if (levels.includes("UNAVAILABLE")) return "UNAVAILABLE";
  if (levels.includes("UNSTRUCTURED")) return "UNSTRUCTURED";
  if (levels.includes("PERMISSION_REQUIRED")) return "PERMISSION_REQUIRED";
  if (levels.includes("MOCK")) return "MOCK";
  if (levels.includes("UNKNOWN")) return "UNKNOWN";
  if (levels.includes("ESTIMATED")) return "ESTIMATED";
  if (levels.includes("CACHED")) return "CACHED";
  if (levels.includes("CURATED")) return "CURATED";
  if (levels.includes("SOCIAL")) return "SOCIAL";
  return "REAL";
}

export function status(places: ProviderLevel, routes: ProviderLevel, weather: ProviderLevel, travelOffers?: ProviderLevel, social?: ProviderLevel, knowledge?: ProviderLevel): ProviderStatus {
  return {
    overall: overall([places, routes, weather, ...(travelOffers ? [travelOffers] : []), ...(social ? [social] : []), ...(knowledge ? [knowledge] : [])]),
    places, routes, weather,
    travelOffers: travelOffers ?? "UNKNOWN",
    social: social ?? "UNKNOWN",
    knowledge: knowledge ?? "UNKNOWN",
  };
}

export function routeLevel(route: ProviderRoute | undefined): ProviderLevel {
  if (!route) return "UNKNOWN";
  return route.source === "amap" ? "REAL" : "MOCK";
}

export function placeLevel(provider: TravelDataProvider): ProviderLevel {
  return provider.kind === "amap" ? "REAL" : "MOCK";
}

export function weatherLevel(provider: TravelDataProvider, missing: boolean): ProviderLevel {
  if (missing) return "UNKNOWN";
  return provider.kind === "amap" ? "REAL" : "MOCK";
}

export function estimateRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }, mode: "walk" | "metro" | "bus" | "taxi" | "drive"): ProviderRoute {
  const distanceMeters = haversineMeters(origin, destination);
  const estimate = estimateTransit(distanceMeters);
  return {
    source: "mock",
    mode,
    distanceMeters,
    durationMinutes: estimate.minutes,
    polyline: [[origin.lng, origin.lat], [destination.lng, destination.lat]],
    steps: [{ instruction: "直线距离估算", distanceMeters, durationMinutes: estimate.minutes }],
  };
}

export function routeSegment(input: {
  trip: Trip;
  dayId: string;
  from: ItineraryItem;
  to: ItineraryItem;
  fromPlace: Place;
  toPlace: Place;
  route: ProviderRoute;
  estimated: boolean;
}): RouteSegment {
  const { route } = input;
  return {
    id: crypto.randomUUID(),
    tripId: input.trip.id,
    dayId: input.dayId,
    fromItemId: input.from.id,
    toItemId: input.to.id,
    fromPlaceId: input.fromPlace.id,
    toPlaceId: input.toPlace.id,
    mode: route.mode,
    distanceMeters: route.distanceMeters,
    durationMinutes: route.durationMinutes,
    meters: route.distanceMeters,
    minutes: route.durationMinutes,
    label: input.estimated ? "估算路线" : "高德路线",
    polyline: route.polyline,
    steps: route.steps,
    provider: input.estimated ? "haversine" : route.source === "amap" ? "amap" : "mock",
    estimated: input.estimated,
    provenance: input.estimated ? { source: "haversine", estimated: true } : route.source === "amap" ? { source: "amap", estimated: false } : { source: "demo", estimated: true },
    updatedAt: new Date().toISOString(),
  };
}

/** Maps a list with at most `limit` workers in flight. Route planning jobs are
 * independent provider calls; AMap personal keys allow ~3 QPS, so 3 is the
 * throughput ceiling we are willing to use. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index] as T, index);
    }
  }));
  return results;
}

export async function enrichRoutes(
  trip: Trip,
  provider: TravelDataProvider,
  allowEstimate: boolean,
  onlyDayId?: string,
  preferredMode?: "walk" | "metro" | "bus" | "taxi" | "drive",
  /** Real routes measured earlier by the route matrix — reused instead of re-querying. */
  matrixRouteLookup?: (fromPlaceId: string, toPlaceId: string) => ProviderRoute | undefined,
) {
  let next = onlyDayId ? recomputeDay(trip, onlyDayId) : recomputeTrip(trip);
  const dayIds = onlyDayId ? [onlyDayId] : next.days.map((day) => day.id);
  let level: ProviderLevel = provider.kind === "amap" ? "REAL" : "MOCK";
  const warnings: string[] = [];

  // Collect every hop across the target days first, then plan them with a
  // small worker pool — the old per-day serial loop left most of the QPS
  // budget idle and stretched generation by seconds per day.
  type SegmentJob = { dayId: string; from: ItineraryItem; to: ItineraryItem; fromPlace: Place; toPlace: Place; mode: "walk" | "metro" | "bus" | "taxi" | "drive" };
  const jobs: SegmentJob[] = [];
  for (const dayId of dayIds) {
    const items = next.items.filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
    for (let index = 0; index < items.length - 1; index += 1) {
      const from = items[index];
      const to = items[index + 1];
      if (!from || !to) continue;
      const fromPlace = next.places.find((place) => place.id === from.placeId);
      const toPlace = next.places.find((place) => place.id === to.placeId);
      if (!fromPlace || !toPlace) continue;
      const baseline = next.segments.find((segment) => segment.dayId === dayId && segment.fromItemId === from.id && segment.toItemId === to.id);
      const mode = baseline?.mode === "highspeed" || baseline?.mode === "flight"
        ? "taxi"
        : preferredMode ?? baseline?.mode ?? "walk";
      jobs.push({ dayId, from, to, fromPlace, toPlace, mode });
    }
  }
  const routed = await mapWithConcurrency(jobs, 3, async (job) => {
    try {
      // Brain route-matrix reuse: a route already measured by the matrix for
      // the same mode is consumed instead of spending another QPS slot.
      const measured = matrixRouteLookup?.(job.fromPlace.id, job.toPlace.id);
      const route = measured && measured.mode === job.mode
        ? measured
        : await provider.planRoute({ origin: job.fromPlace, destination: job.toPlace, mode: job.mode, city: next.destination });
      return { segment: routeSegment({ trip: next, dayId: job.dayId, from: job.from, to: job.to, fromPlace: job.fromPlace, toPlace: job.toPlace, route, estimated: provider.kind !== "amap" }), estimated: false };
    } catch (error) {
      if (!allowEstimate) throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
      const route = estimateRoute(job.fromPlace, job.toPlace, job.mode);
      return { segment: routeSegment({ trip: next, dayId: job.dayId, from: job.from, to: job.to, fromPlace: job.fromPlace, toPlace: job.toPlace, route, estimated: true }), estimated: true };
    }
  });
  const resolvedByDay = new Map<string, RouteSegment[]>();
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const result = routed[index];
    if (!job || !result) continue;
    const { segment, estimated } = result;
    const list = resolvedByDay.get(job.dayId) ?? [];
    list.push(segment);
    resolvedByDay.set(job.dayId, list);
    if (estimated) {
      level = "ESTIMATED";
      warnings.push(`Route ${job.fromPlace.name} → ${job.toPlace.name} uses Haversine estimation`);
    }
  }
  for (const dayId of dayIds) {
    next = { ...next, segments: [...next.segments.filter((segment) => segment.dayId !== dayId), ...resolvedByDay.get(dayId) ?? []] };
    next = recomputeDay(next, dayId);
  }
  return { trip: next, level, warnings };
}

export function uniquePlaces(places: Place[]) {
  return [...new Map(places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng)).map((place) => [place.sourceId ?? place.id, place])).values()];
}

export async function collectCandidates(provider: TravelDataProvider, destination: string) {
  const groups: Array<[string, Place["category"]]> = [
    ["景点", "attraction"], ["美食", "food"], ["咖啡", "cafe"], ["酒店", "hotel"], ["购物", "shopping"], ["展览 室内", "activity"],
  ];
  // AMap Web Service keys commonly have a ~3 QPS quota, and this call runs
  // concurrently with the weather request — so POI searches go in batches of
  // two with a short pause, plus exactly one spaced retry for transient QPS
  // rejections. Faster than the old strictly-serial + fixed-500ms loop,
  // without breaching the ceiling.
  const searchOne = async (query: string, category: Place["category"]): Promise<Place[]> => {
    const attempt = () => provider.searchPlaces({ destination, query, category, limit: 12 });
    try {
      return await attempt();
    } catch (error) {
      if (provider.kind !== "amap") throw error;
      await new Promise((resolve) => setTimeout(resolve, 700));
      return attempt();
    }
  };
  const batchSize = provider.kind === "amap" ? 2 : groups.length;
  const results: Place[][] = [];
  for (let index = 0; index < groups.length; index += batchSize) {
    if (provider.kind === "amap" && index > 0) await new Promise((resolve) => setTimeout(resolve, 400));
    results.push(...await Promise.all(groups.slice(index, index + batchSize).map(([query, category]) => searchOne(query, category))));
  }
  const candidateSet = buildCandidateSet(uniquePlaces(results.flat()), {
    categories: groups.map(([, category]) => category),
    limitPerCategory: 12,
  });
  const candidates = candidateSet.places;
  if (candidates.length < 4) throw new SkillError("NO_POI_RESULTS", `Only ${candidates.length} valid POIs were returned`);
  return candidates;
}

/** A place must trace back to real provider data — never an invented object. */
export function placeProvenanceVerified(place: Place) {
  return place.provenance?.source === "amap" || place.provenance?.source === "demo"
    || ((place.source === "amap" || place.source === "demo") && Boolean(place.sourceId));
}

export function itemType(place: Place): ItineraryItem["type"] {
  if (place.category === "food" || place.category === "cafe") return "food";
  if (place.category === "hotel") return "hotel";
  if (place.category === "activity") return "activity";
  if (place.category === "transport") return "transport";
  return "place";
}

export function isIndoor(place?: Place) {
  if (!place) return false;
  return /室内|博物馆|美术馆|展览|商场|剧场|影院|文创/.test([place.name, place.description, ...place.tags].join(" "));
}

export function isOutdoor(place?: Place) {
  if (!place) return false;
  return /户外|公园|山|江|桥|步道|古镇|广场|夜景/.test([place.name, place.description, ...place.tags].join(" ")) || place.category === "viewpoint";
}

export function currentDayId(trip: Trip, asOf?: string) {
  const date = (asOf ? new Date(asOf) : new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  return trip.days.find((day) => day.date === date)?.id;
}

export function lockedItemIds(trip: Trip) {
  return new Set(trip.items.filter((item) => item.status !== "planned").map((item) => item.id));
}

export function transportContextFromInstruction(
  instruction: string,
  trip: Trip,
): Partial<TransportContext> | null {
  if (!/少走|走路|步行|交通|地铁|轨道|公交|打车|出租车|路线|换乘|行李|无障碍|很累|太累|疲劳/.test(instruction)) {
    return null;
  }
  return {
    travelers: trip.travelers,
    ...( /少走|走路|步行|很累|太累|疲劳/.test(instruction)
      ? { walkingTolerance: "low" as const, fatigue: "high" as const }
      : {}),
    ...( /行李/.test(instruction) ? { hasLuggage: true } : {}),
    ...( /无障碍|老人|轮椅/.test(instruction) ? { accessibilityNeeds: true } : {}),
    ...( /雨|下雨/.test(instruction) ? { weather: "rain" as const } : {}),
  };
}

export function restoreLockedItems(original: Trip, proposed: Trip, locked: Set<string>) {
  const originals = new Map(original.items.filter((item) => locked.has(item.id)).map((item) => [item.id, item]));
  return { ...proposed, items: proposed.items.map((item) => originals.get(item.id) ?? item) };
}

export function socialRouter(): SocialProviderRouter {
  // TikHub is the only social provider: its endpoints return posts that can be
  // verified into SocialObservations. (RedFox was removed — its documented
  // endpoint returned douyin account profiles, which can never produce a post.)
  return new SocialProviderRouter([createTikHubProvider()]);
}

export const DEFAULT_SOCIAL_PLATFORMS: SocialPlatform[] = ["douyin", "xiaohongshu", "weibo", "wechat_search"];

export interface SocialCollectResult {
  observations: SocialObservation[];
  platformStatus: Record<string, SocialProviderStatus>;
  warnings: string[];
}

/**
 * When the caller names a platform, hit it directly; otherwise fan out across
 * the Chinese-content platforms — TikHub's own default is international TikTok,
 * which carries almost no domestic travel content.
 */
export async function collectSocialObservations(
  router: SocialProviderRouter,
  input: { city: string; query?: string; platform?: string; limit: number; operation?: "searchContent" | "getTrending" },
): Promise<SocialCollectResult> {
  const operation = input.operation ?? "searchContent";
  const platform = input.platform as SocialPlatform | undefined;
  if (platform) {
    const result = await router[operation]({ city: input.city, query: input.query, platform, limit: input.limit });
    return { observations: result.data, platformStatus: { [platform]: result.status }, warnings: result.warnings };
  }
  const settled = await Promise.all(DEFAULT_SOCIAL_PLATFORMS.map(async (p) => {
    try {
      const result = await router[operation]({ city: input.city, query: input.query, platform: p, limit: Math.min(input.limit, 5) });
      return { platform: p, result };
    } catch (error) {
      logger.warn("social.collect_failed", { platform: p, operation, error });
      return { platform: p, result: { status: "error" as const, data: [] as SocialObservation[], warnings: ["request failed"] } };
    }
  }));
  const seen = new Set<string>();
  const observations: SocialObservation[] = [];
  for (const { result } of settled) {
    for (const observation of result.data) {
      const dedupeKey = `${observation.provider}|${observation.platform}|${observation.sourceId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      observations.push(observation);
    }
  }
  const platformStatus = Object.fromEntries(settled.map(({ platform, result }) => [
    platform, result.status === "ok" && result.data.length === 0 ? "unavailable" : result.status,
  ]));
  const warnings = settled.flatMap(({ platform, result }) => result.warnings.map((warning) => `${platform}: ${warning}`));
  return { observations, platformStatus, warnings };
}

export function socialLevelFromStatuses(statuses: Record<string, string>, observationCount: number): ProviderLevel {
  const values = Object.values(statuses);
  if (values.includes("ok")) return observationCount > 0 ? "SOCIAL" : "UNKNOWN";
  if (values.includes("error")) return "UNAVAILABLE";
  return "UNAVAILABLE";
}

export function socialQueryStatus(input: {
  requested: boolean;
  statuses: Record<string, SocialProviderStatus>;
  evidenceCount: number;
  usedByPlanner: boolean;
}): NonNullable<Trip["socialQueryStatus"]> {
  if (!input.requested) return "not_requested";
  if (input.usedByPlanner && input.evidenceCount > 0) return "used";
  if (input.evidenceCount > 0 || Object.values(input.statuses).includes("ok")) return "queried_not_used";
  if (Object.values(input.statuses).includes("error")) return "error";
  return "unavailable";
}

export function socialEngagement(observation: SocialObservation): number {
  const { likes = 0, comments = 0, shares = 0 } = observation.metrics;
  return likes + comments + shares;
}

export function recentRelevantObservations(input: { city: string; poi?: string }, observations: SocialObservation[]): SocialObservation[] {
  return observations
    .filter((item) => item.content.includes(input.city) || (input.poi && item.content.includes(input.poi)))
    .filter((item) => !item.publishedAt || Number.isFinite(Date.parse(item.publishedAt)) && Date.now() - Date.parse(item.publishedAt) < 30 * 86_400_000)
    .slice(0, 20);
}

export type PoiMatch = { placeId: string; name: string; confidence: number; matchBasis: "entity_id" | "name_contains" | "unknown" };

/** First-generation POI alignment: entity id when the provider reports one, otherwise name containment. Unmatched evidence stays UNKNOWN. */
export function alignObservationToPois(observation: SocialObservation, poi: string | undefined, places: Array<{ id: string; name: string }> | undefined): PoiMatch[] {
  if (!places?.length) return [];
  const haystack = `${observation.content} ${observation.summary ?? ""}`.toLowerCase();
  const matches: PoiMatch[] = [];
  for (const place of places) {
    const name = place.name.trim();
    if (name.length < 2) continue;
    if (observation.entityId && observation.entityId === place.id) {
      matches.push({ placeId: place.id, name, confidence: 0.8, matchBasis: "entity_id" });
    } else if (haystack.includes(name.toLowerCase())) {
      matches.push({ placeId: place.id, name, confidence: 0.5, matchBasis: "name_contains" });
    } else if (poi && name.includes(poi) && haystack.includes(poi.toLowerCase())) {
      matches.push({ placeId: place.id, name, confidence: 0.4, matchBasis: "name_contains" });
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

export function buildSocialEvidence(input: { city: string; poi?: string; observations: SocialObservation[]; places?: Array<{ id: string; name: string }> }): { evidence: SocialEvidence[]; signals: ReturnType<typeof extractSocialSignals> } {
  const signals = extractSocialSignals(input.observations);
  const evidence = input.observations.map((observation) => {
    const related = signals.filter((signal) => signal.sources.some((source) => source.sourceId === observation.sourceId && source.platform === observation.platform));
    const link = resolveSourceLink({
      platform: observation.platform,
      sourceId: observation.sourceId,
      upstreamUrl: observation.sourceUrl,
    });
    return {
      provider: observation.provider,
      platform: observation.platform,
      sourceId: observation.sourceId,
      ...(link ? { sourceUrl: link.url, sourceUrlKind: link.kind } : {}),
      summary: observation.summary ?? observation.content.slice(0, 180),
      city: observation.city,
      publishedAt: observation.publishedAt,
      fetchedAt: observation.fetchedAt,
      expiresAt: observation.expiresAt,
      signalTypes: related.map((signal) => signal.signalType),
      confidence: related.length ? Math.max(...related.map((signal) => signal.confidence)) : 0.25,
      sampleSize: related.length ? Math.max(...related.map((signal) => signal.sampleSize)) : 1,
      metrics: observation.metrics,
      poiMatches: alignObservationToPois(observation, input.poi, input.places),
      warnings: ["社交平台内容仅作攻略参考，不替代实时供应商事实"],
    } satisfies SocialEvidence;
  });
  return { evidence, signals };
}

export function socialQueryId(input: { city: string; poi?: string; query?: string }): string {
  return createHash("sha256").update(`${input.city}|${input.poi ?? ""}|${input.query ?? ""}`).digest("hex").slice(0, 32);
}
