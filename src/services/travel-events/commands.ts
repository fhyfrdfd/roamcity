import {
  analyzeEventImpactInputSchema,
  getActiveEventsInputSchema,
  getTripStateInputSchema,
  proposeEventReplanInputSchema,
  recordTravelEventInputSchema,
  simulateTravelEventInputSchema,
  successEnvelope,
  type ProviderLevel,
} from "@/skill/contracts";
import { SkillError } from "@/skill/errors";
import type { JsonSkillRepository } from "@/skill/repository";
import type { TravelDataProvider } from "@/skill/providers";
import {
  enrichRoutes,
  lockedItemIds,
  placeLevel,
  restoreLockedItems,
  status,
} from "@/skill/runtime-helpers";
import { loadTripForWrite } from "@/services/trips/write-guard";
import { executeActions } from "@/services/ai/actions/executor";
import { computeTripChangeSet } from "@/services/ai/diff";
import { analyzeEventImpact } from "@/services/impact-engine";
import { actionsFromImpact, type ReplanStrategy } from "@/services/replan/event-replan";
import { MockTravelEventProvider } from "@/skill/event-providers";
import { collectActiveEvents, getTripState } from "@/services/trip-state/engine";
import { MAX_TRIP_EVENTS, travelEventSchema, type TravelEvent } from "@/schemas/travel-event";
import { uid } from "@/lib/utils";
import type { Trip } from "@/types/travel";

export interface TravelEventDeps {
  repository: Pick<JsonSkillRepository, "getTrip" | "updateTrip" | "saveProposal">;
  providerFactory: () => Promise<TravelDataProvider>;
}

export async function recordTravelEventCommand(raw: unknown, deps: TravelEventDeps) {
  const input = recordTravelEventInputSchema.parse(raw);
  const stored = await loadTripForWrite(deps.repository, input.tripId, input.expectedTripRevision);
  const now = new Date().toISOString();
  // confidence/estimated are provenance hints, not event fields — strip
  // them before the strict event schema validates the payload.
  const eventFields: Record<string, unknown> = { ...input.event };
  delete eventFields.confidence;
  delete eventFields.estimated;
  const event = travelEventSchema.parse({
    ...eventFields,
    id: uid("evt"),
    tripId: input.tripId,
    occurredAt: input.event.effectiveFrom ?? now,
    provenance: {
      source: input.event.source ?? "system",
      fetchedAt: now,
      confidence: input.event.confidence ?? 0.5,
      estimated: input.event.estimated ?? false,
    },
  });
  const events = [...(stored.trip.travelEvents ?? []), event];
  // Bounded log: once the cap is hit, the oldest acknowledged/unacknowledged
  // facts fall off first — history beyond the cap is not retained.
  const trimmed = events.slice(Math.max(0, events.length - MAX_TRIP_EVENTS));
  const trip: Trip = { ...stored.trip, travelEvents: trimmed, updatedAt: now };
  const saved = await deps.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
  return successEnvelope(
    { tripId: input.tripId, event, total: (saved.trip.travelEvents ?? []).length, revision: saved.revision, tripHash: saved.hash },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

export async function getActiveEventsCommand(raw: unknown, deps: TravelEventDeps) {
  const input = getActiveEventsInputSchema.parse(raw);
  const stored = await deps.repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  const asOfMs = Date.parse(input.asOf ?? new Date().toISOString());
  // One shared predicate with the TripState engine — defined once.
  const active = collectActiveEvents(stored.trip.travelEvents ?? [], asOfMs, input.includeAcknowledged);
  return successEnvelope(
    { tripId: input.tripId, asOf: input.asOf ?? new Date().toISOString(), events: active, total: active.length },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

/** Phase 6.4: deterministic execution state — no LLM, no providers. */
export async function getTripStateViewCommand(raw: unknown, deps: TravelEventDeps) {
  const input = getTripStateInputSchema.parse(raw);
  const stored = await deps.repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  const state = getTripState(stored.trip, input.asOf ? { asOf: input.asOf } : {});
  return successEnvelope(
    { tripId: input.tripId, state },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    state.constraintViolations,
  );
}

/** Phase 6.5: read-only impact analysis of one event. */
export async function analyzeEventImpactViewCommand(raw: unknown, deps: TravelEventDeps) {
  const input = analyzeEventImpactInputSchema.parse(raw);
  const stored = await deps.repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  const { event } = await resolveAnalysisEvent(stored, input.tripId, input.eventId, input.event, input.asOf);
  const state = getTripState(stored.trip, { asOf: input.asOf ?? event.occurredAt });
  const impact = analyzeEventImpact(event, stored.trip, state);
  return successEnvelope(
    { tripId: input.tripId, eventId: event.id, state, impact },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    impact.unknowns,
  );
}

/** Inline-or-recorded event normalization shared by analyze and replan. */
async function resolveAnalysisEvent(
  stored: { trip: Trip },
  tripId: string,
  eventId: string | undefined,
  inline: unknown,
  asOf: string | undefined,
): Promise<{ event: TravelEvent }> {
  if (eventId) {
    const recorded = (stored.trip.travelEvents ?? []).find((candidate) => candidate.id === eventId);
    if (!recorded) throw new SkillError("INVALID_INPUT", "Event not found on this trip");
    return { event: recorded };
  }
  if (inline) {
    const now = new Date().toISOString();
    const { confidence, estimated, ...eventFields } = inline as { confidence?: number; estimated?: boolean; source?: "provider" | "user" | "system" | "simulation" } & Record<string, unknown>;
    const declaredSource = (inline as { source?: string }).source;
    const event = travelEventSchema.parse({
      ...eventFields,
      id: "evt-analysis",
      tripId,
      occurredAt: (inline as { effectiveFrom?: string }).effectiveFrom ?? asOf ?? now,
      provenance: {
        source: declaredSource ?? "system",
        fetchedAt: now,
        confidence: confidence ?? 0.5,
        estimated: estimated ?? false,
      },
    });
    return { event };
  }
  throw new SkillError("INVALID_INPUT", "provide eventId or event");
}

/**
 * Phase 6.6: event-driven replan. TripState → Impact → deterministic
 * actions → the standard proposal pipeline. Nothing is applied here; the
 * user confirms via the Diff.
 */
export async function proposeEventReplanCommand(raw: unknown, deps: TravelEventDeps) {
  const input = proposeEventReplanInputSchema.parse(raw);
  const stored = await deps.repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  const { event } = await resolveAnalysisEvent(stored, input.tripId, input.eventId, input.event, input.asOf);
  const state = getTripState(stored.trip, { asOf: input.asOf ?? event.occurredAt });
  const impact = analyzeEventImpact(event, stored.trip, state);

  const strategy: Exclude<ReplanStrategy, "auto"> =
    input.strategy === "auto" ? impact.recommendedStrategy : input.strategy;
  const plan = actionsFromImpact(impact, stored.trip, strategy, state);
  const summary = [event.summary ?? event.type, impact.summary, ...plan.notes].filter(Boolean).join(" ");

  if (!plan.actions.length) {
    return successEnvelope(
      { tripId: input.tripId, eventId: event.id, eventType: event.type, strategy, impact, proposalId: null, actions: [], summary, note: "未生成修改动作" },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
      [...impact.unknowns, ...plan.notes],
    );
  }

  const provider = await deps.providerFactory();
  const original = stored.trip;
  const locked = lockedItemIds(original);
  const execution = executeActions(original, plan.actions);
  if (!execution.applied.length) {
    return successEnvelope(
      { tripId: input.tripId, eventId: event.id, eventType: event.type, strategy, impact, proposalId: null, actions: [], summary, note: "没有可执行的动作", rejected: execution.rejected },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
      [...impact.unknowns, ...plan.notes, ...execution.rejected.map((entry) => `动作被拒绝：${entry.reason}`)],
    );
  }
  const affectedDays = new Set<string>();
  for (const action of execution.applied) {
    const payload = action.payload as { dayId?: string };
    const item = (action.payload as { itemId?: string }).itemId
      ? original.items.find((candidate) => candidate.id === (action.payload as { itemId: string }).itemId)
      : undefined;
    const itemDay = item?.dayId ?? state.currentDay?.dayId;
    if (payload.dayId) affectedDays.add(payload.dayId);
    if (itemDay) affectedDays.add(itemDay);
  }
  let proposed = execution.trip;
  let routeStatus: ProviderLevel = provider.kind === "amap" ? "REAL" : "MOCK";
  const warnings: string[] = [];
  for (const dayId of affectedDays) {
    const routed = await enrichRoutes(proposed, provider, input.fallbackPolicy === "estimated", dayId);
    proposed = routed.trip;
    routeStatus = routed.level;
    warnings.push(...routed.warnings);
  }
  proposed = restoreLockedItems(original, proposed, locked);
  const changeSet = computeTripChangeSet(original, proposed, execution.applied, summary);
  const { record: proposal, token } = await deps.repository.saveProposal({
    tripId: original.id,
    baseRevision: stored.revision,
    baseHash: stored.hash,
    actions: execution.applied,
    changeSet,
    proposedTrip: proposed,
  });
  return successEnvelope(
    {
      tripId: original.id,
      eventId: event.id,
      eventType: event.type,
      strategy,
      impact,
      proposalId: proposal.id,
      proposalToken: token,
      baseRevision: proposal.baseRevision,
      actions: proposal.actions,
      changes: proposal.changeSet,
      summary,
    },
    status(placeLevel(provider), routeStatus, "UNKNOWN"),
    [...impact.unknowns, ...plan.notes, ...warnings],
  );
}

/**
 * Phase 6.8: inject a scripted incident (demo/dev only). The recorded event
 * is stamped source="simulation" by the MockTravelEventProvider — it can
 * never pass as real provider data. Gated to demo mode.
 */
export async function simulateTravelEventCommand(raw: unknown, deps: TravelEventDeps) {
  if (process.env.VOYAGE_DEMO_MODE !== "true") {
    throw new SkillError("INVALID_INPUT", "simulate-travel-event 仅在 VOYAGE_DEMO_MODE=true 下可用");
  }
  const input = simulateTravelEventInputSchema.parse(raw);
  const stored = await loadTripForWrite(deps.repository, input.tripId, input.expectedTripRevision);
  const mock = new MockTravelEventProvider();
  const date = input.date ?? stored.trip.startDate;
  // Built lazily per incident: scenarios that require ids must not throw
  // when a different incident is requested.
  let event;
  switch (input.incident) {
    case "flight_delay":
      event = mock.flightDelay(input.flightNo ?? "CA1468", input.delayMinutes ?? 90, input.reservationId);
      break;
    case "heavy_rain":
      event = mock.heavyRain(date);
      break;
    case "poi_closed":
      if (!input.placeId) throw new SkillError("INVALID_INPUT", "poi_closed 需要 placeId");
      event = mock.poiClosed(input.placeId, date);
      break;
    case "user_late":
      event = mock.userLate(input.minutes ?? 45, date);
      break;
    case "road_congested":
      if (!input.segmentId) throw new SkillError("INVALID_INPUT", "road_congested 需要 segmentId");
      event = mock.roadCongested(input.segmentId, date);
      break;
  }
  const recorded = await recordTravelEventCommand({
    tripId: input.tripId, expectedTripRevision: stored.revision, event,
  }, deps) as { data: { event: TravelEvent; revision: number } };
  return simulationEnvelope(input, recorded);
}

function simulationEnvelope(
  input: { tripId: string; incident: string },
  recorded: { data: { event: TravelEvent; revision: number } },
) {
  return successEnvelope(
    { tripId: input.tripId, incident: input.incident, event: recorded.data.event, revision: recorded.data.revision, note: "模拟事件已记录（source=simulation），可用 analyze-event-impact / propose-event-replan 处理" },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    ["这是模拟事件，不是真实供应商数据"],
  );
}
