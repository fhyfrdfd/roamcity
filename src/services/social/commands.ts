import {
  getSocialEvidenceInputSchema,
  getSocialTrendingInputSchema,
  searchSocialInputSchema,
  successEnvelope,
} from "@/skill/contracts";
import { SkillError } from "@/skill/errors";
import type { JsonSkillRepository } from "@/skill/repository";
import type { TravelDataProvider } from "@/skill/providers";
import type { SocialProviderRouter } from "@/services/social/router";
import {
  buildSocialEvidence,
  collectSocialObservations,
  recentRelevantObservations,
  socialEngagement,
  socialLevelFromStatuses,
  socialQueryId,
  status,
  uniquePlaces,
} from "@/skill/runtime-helpers";
import { buildSocialContext } from "@/services/social/context-builder";
import { logger } from "@/lib/logger";

export interface SocialCommandDeps {
  repository: Pick<JsonSkillRepository, "getTrip">;
  providerFactory: () => Promise<TravelDataProvider>;
  socialRouterFactory: () => SocialProviderRouter;
}

export async function searchSocialCommand(raw: unknown, deps: SocialCommandDeps) {
  const input = searchSocialInputSchema.parse(raw);
  const collected = await collectSocialObservations(deps.socialRouterFactory(), { city: input.city, query: input.query, platform: input.platform, limit: input.limit });
  const observations = recentRelevantObservations({ city: input.city, poi: input.poi }, collected.observations);
  const { evidence, signals } = buildSocialEvidence({ city: input.city, poi: input.poi, observations });
  const level = socialLevelFromStatuses(collected.platformStatus, observations.length);
  const warnings = collected.warnings;
  return successEnvelope(
    { city: input.city, queryId: socialQueryId(input), evidence, signals, platformStatus: collected.platformStatus, warnings },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, level),
    warnings,
  );
}

export async function getSocialTrendingCommand(raw: unknown, deps: SocialCommandDeps) {
  const input = getSocialTrendingInputSchema.parse(raw);
  const collected = await collectSocialObservations(deps.socialRouterFactory(), { city: input.city, platform: input.platform, limit: input.limit, operation: "getTrending" });
  const ranked = recentRelevantObservations({ city: input.city }, collected.observations)
    .sort((a, b) => socialEngagement(b) - socialEngagement(a))
    .slice(0, input.limit);
  const { evidence, signals } = buildSocialEvidence({ city: input.city, observations: ranked });
  const level = socialLevelFromStatuses(collected.platformStatus, ranked.length);
  const warnings = collected.warnings;
  return successEnvelope(
    { city: input.city, queryId: socialQueryId(input), evidence, signals, platformStatus: collected.platformStatus, warnings },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, level),
    warnings,
  );
}

export async function getSocialEvidenceCommand(raw: unknown, deps: SocialCommandDeps) {
  const input = getSocialEvidenceInputSchema.parse(raw);
  let places: Array<{ id: string; name: string }> = [];
  if (input.tripId) {
    const stored = await deps.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    places = stored.trip.places.map((place) => ({ id: place.id, name: place.name }));
  } else if (input.poi) {
    try {
      const provider = await deps.providerFactory();
      places = uniquePlaces(await provider.searchPlaces({ destination: input.city, query: input.poi, category: undefined, limit: 8 }))
        .map((place) => ({ id: place.id, name: place.name }));
    } catch (error) {
      logger.warn("social.evidence_poi_search_failed", { city: input.city, poi: input.poi, error });
      places = [];
    }
  }
  const query = [input.poi, input.query].filter(Boolean).join(" ").trim() || undefined;
  const collected = await collectSocialObservations(deps.socialRouterFactory(), { city: input.city, query, limit: input.limit });
  const observations = recentRelevantObservations({ city: input.city, poi: input.poi }, collected.observations);
  const { evidence, signals } = buildSocialEvidence({ city: input.city, poi: input.poi, observations, places });
  const context = buildSocialContext({ city: input.city, poi: input.poi, query: input.query }, signals);
  const level = socialLevelFromStatuses(collected.platformStatus, observations.length);
  const warnings = [...collected.warnings, ...context.warnings.map((message) => `social: ${message}`)];
  return successEnvelope(
    { city: input.city, queryId: socialQueryId(input), evidence, signals, context, platformStatus: collected.platformStatus, warnings },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, level),
    warnings,
  );
}
