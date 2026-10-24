import type { z } from "zod";
import type { ProviderLevel } from "@/skill/contracts";
import { successEnvelope } from "@/skill/contracts";
import { normalizeProviderError, SkillError } from "@/skill/errors";
import type { ProviderRoute, TravelDataProvider } from "@/skill/providers";
import type { JsonSkillRepository } from "@/skill/repository";
import { createTripInputSchema } from "@/skill/contracts";
import {
  DEFAULT_SOCIAL_PLATFORMS,
  buildSocialEvidence,
  collectCandidates,
  collectSocialObservations,
  daysBetween,
  endDate,
  enrichRoutes,
  itemType,
  placeLevel,
  planningConstraintWarnings,
  preferredRouteMode,
  socialLevelFromStatuses,
  socialQueryId,
  socialQueryStatus,
  status,
  weatherLevel,
} from "@/skill/runtime-helpers";
import { estimateBudgetItems } from "@/services/ai/actions/executor";
import { buildTrustMetadata, repairOutlineForTrust } from "@/services/trust";
import { planOutline } from "@/services/planning/outline-planner";
import { alignPlanningDays, filterPlanningCandidates, planningProfileToPrompt } from "@/services/planning/profile";
import { createTripId } from "@/services/planning/rule-planner";
import {
  buildRouteMatrix,
  findRealMatrixRoute,
  routeIntelByPlace,
  summarizeRouteMatrix,
} from "@/services/brain/route-matrix";
import {
  evaluateOutline,
  placeMatchesTerm as brainPlaceMatchesTerm,
  repairOutline,
} from "@/services/brain/constraints";
import type { BrainMetadata, RouteMatrix } from "@/schemas/brain";
import { weatherForDate } from "@/services/weather/merge";
import { queryMeituan } from "@/services/meituan/runner";
import { resolveCityCoverImage } from "@/services/media/city-cover";
import type { SocialProviderRouter } from "@/services/social/router";
import type { SocialObservation, SocialProviderStatus } from "@/services/social/types";
import { logger } from "@/lib/logger";
import type { Day, ItineraryItem, Trip } from "@/types/travel";

export type CreateTripInput = z.output<typeof createTripInputSchema>;

export interface CreateTripDeps {
  provider: TravelDataProvider;
  socialRouter: SocialProviderRouter;
  repository: Pick<JsonSkillRepository, "createTrip">;
}

export async function createTripPlan(input: CreateTripInput, deps: CreateTripDeps) {
  const provider = deps.provider;
  const finish = input.endDate ?? endDate(input.startDate, input.days ?? 1);
  const profile = input.planningProfile;
  // One truth for the trip length: every prompt, filter and validation below
  // must agree, so the profile is normalised before anything reads it.
  const alignedProfile = profile ? alignPlanningDays(profile) : undefined;
  const planningPrompt = alignedProfile
    ? [input.prompt, planningProfileToPrompt(alignedProfile)].filter(Boolean).join("\n")
    : input.prompt;
  const effectiveTravelers = alignedProfile?.travelers ?? input.travelers ?? input.people;
  const effectiveBudget = alignedProfile?.budget ?? input.budget;
  const effectiveVibes = alignedProfile?.vibes.length ? alignedProfile.vibes : input.vibes ?? input.preferences;
  const includeSocial = input.includeSocialEvidence || Boolean(alignedProfile?.socialOptIn || alignedProfile?.includeSocialEvidence);
  const includeOffers = input.includeExternalOffers || Boolean(alignedProfile?.includeExternalOffers);
  // POI search, weather and social observation are mutually independent:
  // running them concurrently instead of back-to-back trims seconds off
  // every generation before the (unavoidably serial) LLM outline call.
  const [providerCandidates, forecasts, social] = await Promise.all([
    collectCandidates(provider, input.destination).catch((error) => {
      throw normalizeProviderError(error, "NO_POI_RESULTS");
    }),
    provider.getWeather(input.destination).catch((error) => {
      if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
      return [];
    }),
    includeSocial
      ? collectSocialObservations(deps.socialRouter, {
          city: input.destination,
          query: planningPrompt,
          limit: 5,
        }).catch((error) => ({
          observations: [] as SocialObservation[],
          platformStatus: Object.fromEntries(DEFAULT_SOCIAL_PLATFORMS.map((platform) => [platform, "error" as const])) as Record<string, SocialProviderStatus>,
          warnings: [error instanceof Error ? error.message : "social search failed"],
        }))
      : undefined,
  ]);
  const candidatesFetchedAt = new Date().toISOString();
  const candidates = alignedProfile
    ? filterPlanningCandidates(providerCandidates, alignedProfile, daysBetween(input.startDate, finish))
    : providerCandidates;
  const constraintWarnings = planningConstraintWarnings(alignedProfile, providerCandidates, candidates);
  if (!candidates.length) {
    throw new SkillError("NO_POI_RESULTS", "旅行画像过滤后没有可用的 provider 候选", { warnings: constraintWarnings });
  }
  const socialBuilt = social
    ? buildSocialEvidence({ city: input.destination, observations: social.observations, places: candidates })
    : { evidence: [], signals: [] };

  // Travel Brain (Phase 4.1): build the partial route matrix BEFORE the LLM
  // orders stops, so the planner sees real A→B time instead of guessing.
  // Off unless VOYAGE_BRAIN=1; any brain failure must never break trip creation.
  const brainEnabled = process.env.VOYAGE_BRAIN === "1";
  const count = daysBetween(input.startDate, finish);
  const tripDates = Array.from({ length: count }, (_, index) => endDate(input.startDate, index + 1));
  const brainTravelers = effectiveTravelers ?? input.people;
  let matrix: RouteMatrix | undefined;
  let matrixRoutes: Map<string, ProviderRoute> | undefined;
  let candidateIntel: Record<string, string> | undefined;
  let routeSummary: string | undefined;
  if (brainEnabled) {
    try {
      const matrixMode = preferredRouteMode(alignedProfile) ?? "walk";
      const matrixPlaces = candidates.slice(0, 24);
      const built = await buildRouteMatrix({
        city: input.destination,
        places: matrixPlaces,
        provider,
        mode: matrixMode,
        priorityPlaceIds: matrixPlaces
          .filter((place) => (alignedProfile?.mustVisit ?? []).some((term) => brainPlaceMatchesTerm(place, term)))
          .map((place) => place.id),
        maxRealEdges: 8,
        travelers: brainTravelers,
      });
      matrix = built.matrix;
      matrixRoutes = built.realRoutes;
      candidateIntel = routeIntelByPlace(matrixPlaces, matrix);
      routeSummary = summarizeRouteMatrix(matrixPlaces, matrix);
    } catch (error) {
      logger.warn("brain.route_matrix_failed", { error });
      routeSummary = undefined;
    }
  }
  const weatherSummary = forecasts.length
    ? tripDates
        .map((date) => {
          const weather = weatherForDate(forecasts, date);
          return `${date} ${weather.condition} ${weather.tempC}°C${weather.condition.includes("雨") ? " [有雨]" : ""}`;
        })
        .join("；")
    : undefined;

  const planResult = await planOutline({
    prompt: planningPrompt,
    destination: input.destination,
    startDate: input.startDate,
    endDate: finish,
    travelers: effectiveTravelers,
    budget: effectiveBudget,
    vibes: effectiveVibes,
    candidates,
    ...(socialBuilt.signals.length ? { social: { signals: socialBuilt.signals } } : {}),
    ...(candidateIntel ? { candidateIntel } : {}),
    ...(routeSummary ? { routeSummary } : {}),
    ...(weatherSummary ? { weatherSummary } : {}),
  });

  // Constraint gate: check the outline against the traveller's stated hard
  // constraints, repair once deterministically, and keep whatever still
  // violates as warnings. The LLM's choice is never silently trusted.
  const repairedOutline = repairOutlineForTrust(planResult.outline, candidates);
  let outline = repairedOutline.outline;
  let brainMeta: BrainMetadata | undefined;
  const brainWarnings: string[] = [];
  if (brainEnabled) {
    try {
      const brainContext = {
        candidates,
        ...(alignedProfile ? { profile: alignedProfile } : {}),
        ...(matrix ? { matrix } : {}),
        expectedDays: count,
        budget: effectiveBudget,
        travelers: brainTravelers,
      };
      let evaluation = evaluateOutline(outline, brainContext);
      let repairs: string[] = [];
      if (evaluation.hardViolations.length) {
        const repaired = repairOutline(outline, evaluation, brainContext);
        outline = repaired.outline;
        repairs = repaired.applied;
        evaluation = evaluateOutline(outline, brainContext);
      }
      // The unmatched-must-visit data gap is already reported by
      // planningConstraintWarnings below; don't say it twice.
      brainWarnings.push(...evaluation.warnings.filter((warning) => !(warning.startsWith("必去「") && warning.includes("在候选地点中无匹配"))));
      brainWarnings.push(...repairs.map((fix) => `Travel Brain 修复：${fix}`));
      brainMeta = {
        version: "4.1",
        routeMatrix: {
          realEdges: matrix?.edges.filter((edge) => edge.queried).length ?? 0,
          estimatedEdges: (matrix?.edges.length ?? 0) - (matrix?.edges.filter((edge) => edge.queried).length ?? 0),
          coverage: matrix?.coverage ?? 0,
        },
        constraintEvaluation: evaluation,
        repairs,
      };
    } catch (error) {
      logger.warn("brain.constraint_gate_failed", { error });
    }
  }

  const socialStatus = socialQueryStatus({
    requested: includeSocial,
    statuses: social?.platformStatus ?? {},
    evidenceCount: socialBuilt.evidence.length,
    usedByPlanner: planResult.source === "llm" && socialBuilt.signals.length > 0,
  });

  const tripId = createTripId();
  const days: Day[] = Array.from({ length: count }, (_, index) => {
    const date = endDate(input.startDate, index + 1);
    return {
      id: `${tripId}-day-${index + 1}`,
      tripId,
      index,
      date,
      title: outline.dayPlans[index]?.title ?? `Day ${index + 1}`,
      summary: outline.dayPlans[index]?.summary ?? "",
      weather: weatherForDate(forecasts, date),
    };
  });
  const items: ItineraryItem[] = [];
  outline.dayPlans.forEach((dayPlan, dayIndex) => dayPlan.stops.forEach((stop, order) => {
    const place = candidates.find((candidate) => candidate.id === stop.placeId);
    if (!place || !days[dayIndex]) return;
    items.push({
      id: crypto.randomUUID(), dayId: days[dayIndex].id, type: itemType(place), placeId: place.id,
      startTime: stop.startTime, duration: stop.durationMinutes, order, status: "planned", ...(stop.meal ? { meal: stop.meal } : {}),
    });
  }));
  let trip: Trip = {
    id: tripId, title: planResult.outline.title, destination: input.destination, origin: alignedProfile?.origin ?? input.origin, startDate: input.startDate, endDate: finish,
    travelers: effectiveTravelers, budget: effectiveBudget, currency: "CNY", status: "ready",
    estimatedSpend: Math.round(effectiveBudget * 0.85), coverImage: "", vibe: effectiveVibes,
    prompt: planningPrompt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), days, items,
    segments: [], places: candidates, hotels: [], restaurants: [], activities: [], transports: [], tasks: [], budgetItems: [],
    planningMetadata: {
      source: planResult.source,
      llm: planResult.llm,
      ...(planResult.fallbackReason ? { fallbackReason: planResult.fallbackReason } : {}),
      ...(input.planningSessionId ? { planningSessionId: input.planningSessionId } : {}),
      ...(alignedProfile ? { planningProfile: alignedProfile } : {}),
      ...(brainMeta ? { brain: brainMeta } : {}),
      social: socialStatus,
    },
    socialQueryStatus: socialStatus,
    ...(social
      ? {
          socialQueryId: socialQueryId({ city: input.destination, query: planningPrompt }),
          socialPlatformStatus: social.platformStatus,
          socialEvidence: socialBuilt.evidence,
          socialSignals: socialBuilt.signals,
          socialWarnings: social.warnings,
        }
      : {}),
  };
  trip = estimateBudgetItems(trip);
  const routePromise = enrichRoutes(
    trip,
    provider,
    input.fallbackPolicy === "estimated",
    undefined,
    preferredRouteMode(alignedProfile),
    matrixRoutes ? (fromPlaceId: string, toPlaceId: string) => findRealMatrixRoute(matrixRoutes, fromPlaceId, toPlaceId) : undefined,
  );
  const offerPromise = includeOffers
    ? queryMeituan({
        origin: alignedProfile?.origin ?? input.origin,
        destination: input.destination,
        startDate: input.startDate,
        endDate: finish,
        travelers: effectiveTravelers,
        budget: effectiveBudget,
        query: planningPrompt || `推荐${input.destination}的交通、酒店、景点门票、美食和优惠`,
        city: input.destination,
        categories: input.offerCategories,
      }).then((result) => ({ result })).catch((error: unknown) => ({ error }))
    : Promise.resolve({ result: null as Awaited<ReturnType<typeof queryMeituan>> | null });
  const coverPromise = resolveCityCoverImage(input.destination, candidates);
  const [routed, offerOutcome, coverImage] = await Promise.all([routePromise, offerPromise, coverPromise]);
  let finalTrip = routed.trip;
  if (coverImage) finalTrip = { ...finalTrip, coverImage };
  let offerLevel: ProviderLevel = "UNKNOWN";
  const offerWarnings: string[] = [];
  if (includeOffers) {
    if ("result" in offerOutcome && offerOutcome.result) {
      const offerResult = offerOutcome.result;
      finalTrip = { ...finalTrip, offers: offerResult.offers, offerProviderStatus: offerResult.status };
      offerLevel = offerResult.status.overall;
      offerWarnings.push(...(offerResult.status.warnings ?? []));
    } else {
      const error = "error" in offerOutcome ? offerOutcome.error : undefined;
      const message = error instanceof SkillError ? error.message : error instanceof Error ? error.message.replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]") : "Meituan offers are unavailable";
      finalTrip = { ...finalTrip, offers: [], offerProviderStatus: { overall: "UNAVAILABLE", warnings: [message] } };
      offerLevel = "UNAVAILABLE";
      offerWarnings.push(message);
    }
  }
  // Trust metadata is computed only after route enrichment, so evidence cards
  // can cite the actual segment distance and provider provenance.
  finalTrip = { ...finalTrip, trust: buildTrustMetadata(finalTrip, alignedProfile, candidatesFetchedAt) };
  const stored = await deps.repository.createTrip(finalTrip);
  const missingWeather = days.some((day) => day.weather.provenance?.source === "unavailable");
  const socialLevel = includeSocial
    ? socialLevelFromStatuses(social?.platformStatus ?? {}, socialBuilt.evidence.length)
    : undefined;
  const providerStatus = status(
    placeLevel(provider),
    routed.level,
    weatherLevel(provider, missingWeather),
    includeOffers ? offerLevel : undefined,
    socialLevel,
  );
  return successEnvelope(
    { tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash },
    providerStatus,
    [...constraintWarnings, ...routed.warnings, ...brainWarnings, ...repairedOutline.repairs, ...(finalTrip.trust?.validation.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message) ?? []), ...(social?.warnings ?? []), ...(planResult.fallbackReason ? [planResult.fallbackReason] : []), ...offerWarnings],
  );
}
