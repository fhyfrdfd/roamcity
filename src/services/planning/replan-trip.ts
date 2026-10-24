import type { z } from "zod";
import { replanTripInputSchema, successEnvelope, type ProviderLevel } from "@/skill/contracts";
import { normalizeProviderError, SkillError } from "@/skill/errors";
import type { TravelDataProvider } from "@/skill/providers";
import type { JsonSkillRepository } from "@/skill/repository";
import { enrichRoutes, status } from "@/skill/runtime-helpers";
import { executeActions } from "@/services/ai/actions/executor";
import type { TravelAction } from "@/services/ai/actions/types";
import { computeTripChangeSet } from "@/services/ai/diff";
import { buildTransportKnowledgeContext } from "@/services/knowledge/context-builder";
import { buildRouteOptionSet } from "@/services/transport/options";
import type { ScoredTransportOption, TransportContext } from "@/types/transport-intelligence";

export type ReplanTripInput = z.output<typeof replanTripInputSchema>;

export interface ReplanTripDeps {
  repository: Pick<JsonSkillRepository, "getTrip" | "saveProposal">;
  providerFactory: () => Promise<TravelDataProvider>;
}

export async function replanTripPlan(input: ReplanTripInput, deps: ReplanTripDeps) {
  const stored = await deps.repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  const allowEstimate = input.fallbackPolicy === "estimated";
  let provider: TravelDataProvider | undefined;
  try {
    provider = await deps.providerFactory();
  } catch (error) {
    if (!allowEstimate) throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
  }

  const original = stored.trip;
  const targetDays = input.dayId
    ? original.days.filter((day) => day.id === input.dayId)
    : original.days;
  if (!targetDays.length) throw new SkillError("INVALID_INPUT", "Target day not found");

  const actions: TravelAction[] = [];
  const routePlans: Array<{
    dayId: string;
    segmentId: string;
    fromPlace: string;
    toPlace: string;
    previousMode: string;
    recommendedMode: string;
    score: number;
    recommended: ScoredTransportOption;
    alternatives: ScoredTransportOption[];
  }> = [];
  const warnings: string[] = [];
  const knowledgeById = new Map<string, Awaited<ReturnType<typeof buildTransportKnowledgeContext>>["evidence"][number]>();
  const knowledgeRetrievals: Array<{
    dayId: string;
    strategy: string;
    vectorUsed: boolean;
    databaseUsed: boolean;
    query: string;
    citations: Awaited<ReturnType<typeof buildTransportKnowledgeContext>>["citations"];
  }> = [];

  for (const day of targetDays) {
    const baseDayContext: Partial<TransportContext> = {
      ...input.context,
      travelers: input.context.travelers ?? original.travelers,
      weather: input.context.weather ??
        (day.weather.icon === "rain" || day.weather.condition.includes("雨") ? "rain" : "unknown"),
    };
    const planningContext = await buildTransportKnowledgeContext({
      city: original.destination,
      context: baseDayContext,
      userQuery: [day.title, day.summary, input.instruction, "市内交通 路线优化"].filter(Boolean).join(" "),
      limit: 8,
    });
    planningContext.evidence.forEach((match) => knowledgeById.set(match.id, match));
    knowledgeRetrievals.push({
      dayId: day.id,
      strategy: planningContext.retrieval.strategy,
      vectorUsed: planningContext.retrieval.vectorUsed,
      databaseUsed: planningContext.retrieval.databaseUsed,
      query: planningContext.query,
      citations: planningContext.citations,
    });
    warnings.push(...planningContext.retrieval.warnings.map((warning) => `Knowledge: ${warning}`));
    const dayContext: Partial<TransportContext> = {
      ...baseDayContext,
      ...planningContext.effectiveTransportContext,
    };
    const segments = original.segments.filter((segment) => segment.dayId === day.id);
    for (const segment of segments) {
      const fromPlace = original.places.find((place) => place.id === segment.fromPlaceId);
      const toPlace = original.places.find((place) => place.id === segment.toPlaceId);
      if (!fromPlace || !toPlace) continue;
      const optionSet = await buildRouteOptionSet({
        provider,
        origin: { lat: fromPlace.lat, lng: fromPlace.lng },
        destination: { lat: toPlace.lat, lng: toPlace.lng },
        city: original.destination,
        context: dayContext,
        allowEstimate,
      }).catch((error) => {
        throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
      });
      warnings.push(...optionSet.warnings);
      const recommended = optionSet.options[0];
      if (!recommended) continue;
      routePlans.push({
        dayId: day.id,
        segmentId: segment.id,
        fromPlace: fromPlace.name,
        toPlace: toPlace.name,
        previousMode: segment.mode,
        recommendedMode: recommended.mode,
        score: recommended.score,
        recommended,
        alternatives: optionSet.options.slice(1, 4),
      });
      if (recommended.mode !== segment.mode) {
        actions.push({
          type: "CHANGE_ROUTE_MODE",
          payload: { segmentId: segment.id, dayId: day.id, newMode: recommended.mode },
        });
      }
    }
  }

  const knowledge = [...knowledgeById.values()];

  if (!actions.length) {
    return successEnvelope({
      tripId: original.id,
      proposalId: null,
      routePlans,
      knowledge,
      knowledgeRetrievals,
      summary: "当前市内交通方式已符合综合评分，无需修改。",
    }, status("UNKNOWN", provider?.kind === "amap" ? "REAL" : "ESTIMATED", "UNKNOWN"), warnings);
  }

  const execution = executeActions(original, actions);
  let proposed = execution.trip;
  let routeStatus: ProviderLevel = provider?.kind === "amap" ? "REAL" : "ESTIMATED";
  if (provider) {
    for (const day of targetDays) {
      const routed = await enrichRoutes(proposed, provider, allowEstimate, day.id);
      proposed = routed.trip;
      routeStatus = routed.level;
      warnings.push(...routed.warnings);
    }
  } else {
    const planBySegment = new Map(routePlans.map((plan) => [plan.segmentId, plan.recommended]));
    proposed = {
      ...proposed,
      segments: proposed.segments.map((segment) => {
        const recommended = planBySegment.get(segment.id);
        if (!recommended) return segment;
        return {
          ...segment,
          mode: recommended.mode,
          distanceMeters: recommended.distanceMeters,
          durationMinutes: recommended.durationMinutes,
          meters: recommended.distanceMeters,
          minutes: recommended.durationMinutes,
          label: recommended.mode,
          polyline: recommended.polyline,
          steps: recommended.steps,
          provider: recommended.source === "amap" ? "amap" : recommended.source === "mock" ? "mock" : "haversine",
          estimated: recommended.estimated,
          estimatedCost: Math.round((recommended.cost.min + recommended.cost.max) / 2),
          provenance: recommended.estimated
            ? { source: "haversine" as const, estimated: true as const }
            : { source: "amap" as const, estimated: false as const },
          updatedAt: recommended.updatedAt,
        };
      }),
    };
  }

  const summary = "已按时间、费用、步行、换乘、天气、疲劳与数据可靠性重新评估市内交通。";
  const changeSet = computeTripChangeSet(original, proposed, execution.applied, summary);
  const { record: proposal, token } = await deps.repository.saveProposal({
    tripId: original.id,
    baseRevision: stored.revision,
    baseHash: stored.hash,
    actions: execution.applied,
    changeSet,
    proposedTrip: proposed,
  });
  return successEnvelope({
    proposalId: proposal.id,
    proposalToken: token,
    tripId: original.id,
    baseRevision: proposal.baseRevision,
    actions: proposal.actions,
    changes: proposal.changeSet,
    routePlans,
    knowledge,
    knowledgeRetrievals,
    summary,
  }, status("UNKNOWN", routeStatus, "UNKNOWN"), warnings);
}

