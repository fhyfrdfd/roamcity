import path from "node:path";
import { executeActions } from "@/services/ai/actions/executor";
import type { TravelAction } from "@/services/ai/actions/types";
import { buildRouteOptionSet } from "@/services/transport/options";
import { retrieveTravelKnowledgeHybrid } from "@/services/knowledge/hybrid-retriever";
import { buildTransportKnowledgeContext } from "@/services/knowledge/context-builder";
import { planActionsWithRules, resolveRequestedDay } from "@/services/ai/actions/rule-planner";
import { computeTripChangeSet } from "@/services/ai/diff";
import { optimizeTripPlan } from "@/services/itinerary-optimizer";
import { buildTodayContext } from "@/services/today/context";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import type { RouteSegment, TaskStatus, Trip } from "@/types/travel";
import {
  applyChangeInputSchema,
  createTripInputSchema,
  getTripInputSchema,
  getRouteOptionsInputSchema,
  optimizeTransportInputSchema,
  optimizeItineraryInputSchema,
  getTodayContextInputSchema,
  retrieveTravelKnowledgeInputSchema,
  replanTripInputSchema,
  planRouteInputSchema,
  proposeChangeInputSchema,
  proposeTrustReplanInputSchema,
  searchPlacesInputSchema,
  reorderDayInputSchema,
  addPlaceItemInputSchema,
  setItemStatusInputSchema,
  removeItemInputSchema,
  removeDayInputSchema,
  importRouteInputSchema,
  setTaskStatusInputSchema,
  addPlaceInputSchema,
  restoreTripInputSchema,
  successEnvelope,
  type ProviderLevel,
  type ProviderStatus,
  type SkillCommand,
} from "./contracts";
import { normalizeProviderError, SkillError } from "./errors";
import { providerFromEnvironment, type TravelDataProvider } from "./providers";
import { JsonSkillRepository } from "./repository";
import { SocialProviderRouter } from "@/services/social/router";
import { annotateChangeSetReasons, buildTrustMetadata, buildTrustReplan } from "@/services/trust";
import { createTripPlan } from "@/services/planning/create-trip";
import { replanTripPlan } from "@/services/planning/replan-trip";
import { addReservationCommand, getReservationsCommand, importReservationsCommand, removeReservationCommand, updateReservationCommand } from "@/services/reservations/commands";
import {
  deleteTravelerMemoryCommand,
  disableTravelerMemoryCommand,
  getTravelerMemoryCommand,
  updateTravelerMemoryCommand,
  type MemoryCommandDeps,
} from "@/services/memory/commands";
import { getConstraintsCommand } from "@/services/brain/commands";
import { getPlaceCommand, updateTripCommand, type TripCommandDeps } from "@/services/trips/commands";
import { getWeatherCommand } from "@/services/weather/commands";
import {
  refreshTravelOffersCommand,
  searchFlightsCommand,
  searchTravelOffersCommand,
  type OfferCommandDeps,
} from "@/services/offers/commands";
import {
  getSocialEvidenceCommand,
  getSocialTrendingCommand,
  searchSocialCommand,
  type SocialCommandDeps,
} from "@/services/social/commands";
import {
  analyzeEventImpactViewCommand,
  getActiveEventsCommand,
  getTripStateViewCommand,
  proposeEventReplanCommand,
  recordTravelEventCommand,
  simulateTravelEventCommand,
  type TravelEventDeps,
} from "@/services/travel-events/commands";
import {
  currentDayId,
  enrichRoutes,
  estimateRoute,
  isIndoor,
  isOutdoor,
  itemType,
  lockedItemIds,
  placeLevel,
  placeProvenanceVerified,
  restoreLockedItems,
  routeLevel,
  socialRouter,
  status,
  transportContextFromInstruction,
  uniquePlaces,
} from "./runtime-helpers";



export class VoyageSkillRuntime {
  constructor(
    private readonly repository: JsonSkillRepository,
    private readonly providerFactory: () => Promise<TravelDataProvider> = providerFromEnvironment,
    private readonly socialRouterFactory: () => SocialProviderRouter = socialRouter,
  ) {}

  async createTrip(raw: unknown) {
    const input = createTripInputSchema.parse(raw);
    const provider = await this.providerFactory();
    return createTripPlan(input, {
      provider,
      socialRouter: this.socialRouterFactory(),
      repository: this.repository,
    });
  }

  async getTrip(raw: unknown) {
    const { tripId } = getTripInputSchema.parse(raw);
    const stored = await this.repository.getTrip(tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    return successEnvelope({ tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
  }

  async searchPlaces(raw: unknown) {
    const input = searchPlacesInputSchema.parse(raw);
    const provider = await this.providerFactory();
    const places = uniquePlaces(await provider.searchPlaces(input).catch((error) => {
      throw normalizeProviderError(error, "NO_POI_RESULTS");
    }));
    if (!places.length) throw new SkillError("NO_POI_RESULTS", "No matching places found");
    return successEnvelope({ places }, status(placeLevel(provider), "UNKNOWN", "UNKNOWN"));
  }

  async planRoute(raw: unknown) {
    const input = planRouteInputSchema.parse(raw);
    const provider = await this.providerFactory();
    try {
      const route = await provider.planRoute(input);
      return successEnvelope({ route: { ...route, estimated: provider.kind !== "amap" } }, status("UNKNOWN", routeLevel(route), "UNKNOWN"));
    } catch (error) {
      if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
      const route = estimateRoute(input.origin, input.destination, input.mode);
      return successEnvelope({ route: { ...route, source: "haversine", estimated: true } }, status("UNKNOWN", "ESTIMATED", "UNKNOWN"), ["Route uses Haversine estimation"]);
    }
  }

  async getRouteOptions(raw: unknown) {
    const input = getRouteOptionsInputSchema.parse(raw);
    const allowEstimate = input.fallbackPolicy === "estimated";
    let provider: TravelDataProvider | undefined;
    try {
      provider = await this.providerFactory();
    } catch (error) {
      if (!allowEstimate) throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
    }
    const routeOptions = await buildRouteOptionSet({
      provider,
      origin: input.origin,
      destination: input.destination,
      city: input.city,
      modes: input.modes,
      context: input.context,
      allowEstimate,
    }).catch((error) => {
      throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
    });
    const routeStatus: ProviderLevel = routeOptions.options.some((option) => option.estimated)
      ? "ESTIMATED"
      : provider?.kind === "amap" ? "REAL" : "MOCK";
    return successEnvelope(
      { routeOptions },
      status("UNKNOWN", routeStatus, "UNKNOWN"),
      routeOptions.warnings,
    );
  }

  async optimizeTransport(raw: unknown) {
    const input = optimizeTransportInputSchema.parse(raw);
    const planningContext = await buildTransportKnowledgeContext({
      city: input.city,
      context: input.context,
      userQuery: "城市地形 市内交通 步行 换乘 天气 疲劳 行李",
      limit: 8,
    });
    const envelope = await this.getRouteOptions({
      ...input,
      context: planningContext.effectiveTransportContext,
    }) as {
      data: { routeOptions: Awaited<ReturnType<typeof buildRouteOptionSet>> };
      warnings: string[];
      providerStatus: ProviderStatus;
    };
    const routeOptions = envelope.data.routeOptions;
    return successEnvelope(
      {
        recommended: routeOptions.options[0],
        alternatives: routeOptions.options.slice(1),
        routeOptions,
        knowledge: planningContext.evidence,
        knowledgeRetrieval: planningContext.retrieval,
        knowledgeCitations: planningContext.citations,
        knowledgeRationale: planningContext.rationale,
      },
      envelope.providerStatus,
      [...envelope.warnings, ...planningContext.retrieval.warnings],
    );
  }

  async retrieveTravelKnowledge(raw: unknown) {
    const input = retrieveTravelKnowledgeInputSchema.parse(raw);
    const retrieval = await retrieveTravelKnowledgeHybrid(input);
    return successEnvelope({
      city: input.city,
      query: input.query,
      matches: retrieval.matches,
      retrieval: {
        strategy: retrieval.strategy,
        vectorUsed: retrieval.vectorUsed,
        databaseUsed: retrieval.databaseUsed,
        note: "RAG knowledge supplements live providers; realtime route, weather, availability and price facts stay authoritative.",
      },
    }, status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, undefined, retrieval.matches.length ? "CURATED" : "UNKNOWN"), retrieval.warnings);
  }

  async replanTrip(raw: unknown) {
    const input = replanTripInputSchema.parse(raw);
    return replanTripPlan(input, {
      repository: this.repository,
      providerFactory: this.providerFactory,
    });
  }

  async getWeather(raw: unknown) {
    return getWeatherCommand(raw, { providerFactory: this.providerFactory });
  }


  private offerDeps(): OfferCommandDeps {
    return { repository: this.repository, providerFactory: this.providerFactory };
  }

  async searchFlights(raw: unknown) {
    return searchFlightsCommand(raw);
  }

  async searchTravelOffers(raw: unknown) {
    return searchTravelOffersCommand(raw);
  }

  async refreshTravelOffers(raw: unknown) {
    return refreshTravelOffersCommand(raw, this.offerDeps());
  }


  async reorderDay(raw: unknown) {
    const input = reorderDayInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    if (!stored.trip.days.some((day) => day.id === input.dayId)) {
      // Without this a bad dayId "succeeds" with zero items reordered while
      // still bumping the revision for every concurrent editor.
      throw new SkillError("INVALID_INPUT", "目标日期不存在");
    }
    const rank = new Map(input.orderedItemIds.map((id, index) => [id, index]));
    const trip = recomputeDay({ ...stored.trip, items: stored.trip.items.map((item) => item.dayId === input.dayId && rank.has(item.id) ? { ...item, order: rank.get(item.id)! } : item) }, input.dayId);
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async addPlaceItem(raw: unknown) {
    const input = addPlaceItemInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    if (!stored.trip.days.some((day) => day.id === input.dayId)) {
      throw new SkillError("INVALID_INPUT", "目标日期不存在");
    }
    const place = input.place;
    // Provenance guard: the place must be traceable to real provider data. A
    // hand-built or LLM-invented object can never enter a trip through here.
    if (!placeProvenanceVerified(place)) {
      throw new SkillError("PLACE_SOURCE_UNVERIFIED", "该地点缺少可核实的真实数据来源，不能加入行程");
    }
    let trip = structuredClone(stored.trip);
    if (!trip.items.some((item) => item.dayId === input.dayId && item.placeId === place.id)) {
      if (!trip.places.some((existing) => existing.id === place.id)) trip.places.push(place);
      const order = trip.items.filter((item) => item.dayId === input.dayId).length;
      trip.items.push({
        id: crypto.randomUUID(),
        dayId: input.dayId,
        type: itemType(place),
        placeId: place.id,
        startTime: "10:00",
        duration: place.stayMinutes || 60,
        order,
        status: "planned",
      });
      trip = recomputeDay(trip, input.dayId);
    } else {
      // Idempotent hit: report the stored trip as-is. Writing would bump the
      // revision for no change and trigger spurious conflicts elsewhere.
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * Bookmarks a provenance-verified place onto the trip without scheduling
   * it into any day — the persistence behind the map-mark buttons.
   */
  /**
   * Restores a full trip snapshot (undo/redo). User-initiated only, never
   * LLM-driven, revision-locked like every other write, and the trip id is
   * pinned to the input so a snapshot cannot be written under another record.
   */
  async restoreTrip(raw: unknown) {
    const input = restoreTripInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    // The snapshot already round-tripped through tripSchema; the cast matches
    // the repository's own validated-trip typing (segments arrive narrower).
    const trip = { ...(input.trip as Trip), id: input.tripId, updatedAt: new Date().toISOString() };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async addPlace(raw: unknown) {
    const input = addPlaceInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const place = input.place;
    if (!placeProvenanceVerified(place)) {
      throw new SkillError("PLACE_SOURCE_UNVERIFIED", "该地点缺少可核实的真实数据来源，不能加入地图");
    }
    if (stored.trip.places.some((existing) => existing.id === place.id)) {
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    const trip = { ...stored.trip, places: [...stored.trip.places, place] };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * One-click guide import: ordered, provenance-verified places are spread
   * across trip days in a single transaction, each stop getting a check-in
   * task linked to its item. Recomputing every affected day draws the route
   * lines immediately.
   */
  async importRoute(raw: unknown) {
    const input = importRouteInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const totalPlaces = input.assignments.reduce((total, assignment) => total + assignment.places.length, 0);
    if (totalPlaces > 20) throw new SkillError("INVALID_INPUT", "一次最多导入 20 个地点");

    let trip = structuredClone(stored.trip);
    const touchedDays = new Set<string>();
    let importedCount = 0;
    for (const assignment of input.assignments) {
      if (!trip.days.some((day) => day.id === assignment.dayId)) {
        throw new SkillError("INVALID_INPUT", `目标日期不存在：${assignment.dayId}`);
      }
      let order = trip.items.filter((item) => item.dayId === assignment.dayId).length;
      for (const place of assignment.places) {
        if (!placeProvenanceVerified(place)) {
          throw new SkillError("PLACE_SOURCE_UNVERIFIED", `「${place.name}」缺少可核实的真实数据来源，不能导入`);
        }
        const duplicate = trip.items.some((item) => item.dayId === assignment.dayId && item.placeId === place.id);
        if (duplicate) continue;
        if (!trip.places.some((existing) => existing.id === place.id)) trip.places.push(place);
        const itemId = crypto.randomUUID();
        trip.items.push({
          id: itemId,
          dayId: assignment.dayId,
          type: itemType(place),
          placeId: place.id,
          startTime: "10:00",
          duration: place.stayMinutes || 60,
          order,
          status: "planned",
        });
        order += 1;
        touchedDays.add(assignment.dayId);
        importedCount += 1;
        if (input.createTasks && !trip.tasks.some((task) => task.dayId === assignment.dayId && task.placeId === place.id)) {
          trip.tasks.push({
            id: crypto.randomUUID(),
            tripId: input.tripId,
            dayId: assignment.dayId,
            placeId: place.id,
            linkedItemId: itemId,
            title: place.name,
            group: "day",
            status: "todo",
            checkin: true,
          });
        }
      }
    }
    if (!importedCount) {
      // Every place was already on the plan — nothing to write, no revision bump.
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    for (const dayId of touchedDays) {
      trip = recomputeDay(trip, dayId);
    }
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({
      tripId: input.tripId,
      trip: saved.trip,
      revision: saved.revision,
      tripHash: saved.hash,
      importedCount,
    });
  }

  async setTaskStatus(raw: unknown) {
    const input = setTaskStatusInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const task = stored.trip.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) throw new SkillError("INVALID_INPUT", "任务不存在");
    if (task.status === input.status) {
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    const trip = {
      ...stored.trip,
      tasks: stored.trip.tasks.map((candidate) => candidate.id === input.taskId ? { ...candidate, status: input.status } : candidate),
    };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async setItemStatus(raw: unknown) {
    const input = setItemStatusInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const item = stored.trip.items.find((candidate) => candidate.id === input.itemId);
    if (!item) throw new SkillError("INVALID_INPUT", "行程条目不存在");
    if (item.status === input.status) {
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    // Check-in linkage: ticking a stop off also ticks (or unticks, symmetrically)
    // its linked check-in task, so the checklist strikes itself through.
    const taskStatus: TaskStatus = input.status === "done" ? "done" : "todo";
    const trip = {
      ...stored.trip,
      items: stored.trip.items.map((candidate) => candidate.id === input.itemId ? { ...candidate, status: input.status } : candidate),
      tasks: stored.trip.tasks.map((task) => {
        const linked = task.linkedItemId === item.id
          || (Boolean(task.checkin) && task.dayId === item.dayId && task.placeId === item.placeId);
        return linked ? { ...task, status: taskStatus } : task;
      }),
    };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * Removing a stop from its day. The check-in task attached to the stop goes
   * with it (same linkage rule as setItemStatus, applied symmetrically) and
   * the day is recomputed so timings and segments stay consistent.
   */
  async removeItem(raw: unknown) {
    const input = removeItemInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const item = stored.trip.items.find((candidate) => candidate.id === input.itemId);
    if (!item) throw new SkillError("INVALID_INPUT", "行程条目不存在");
    let trip: Trip = {
      ...stored.trip,
      items: stored.trip.items.filter((candidate) => candidate.id !== input.itemId),
      tasks: stored.trip.tasks.filter((task) => {
        const linked = task.linkedItemId === item.id
          || (Boolean(task.checkin) && task.dayId === item.dayId && task.placeId === item.placeId);
        return !linked;
      }),
    };
    trip = recomputeDay(trip, item.dayId);
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * Removing an entire day. The day's items, tasks and cross-item segments go
   * with it, remaining days are re-indexed (Day N stays contiguous), and a
   * full recompute keeps timing and segments consistent afterwards. Places
   * survive the deletion — a place may be a map bookmark or referenced
   * elsewhere, and remove-item never deletes places either.
   */
  async removeDay(raw: unknown) {
    const input = removeDayInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const day = stored.trip.days.find((candidate) => candidate.id === input.dayId);
    if (!day) throw new SkillError("INVALID_INPUT", "行程天不存在");
    if (stored.trip.days.length <= 1) throw new SkillError("INVALID_INPUT", "至少要保留一天行程");
    const dayItemIds = new Set(stored.trip.items.filter((item) => item.dayId === input.dayId).map((item) => item.id));
    let trip: Trip = {
      ...stored.trip,
      days: stored.trip.days.filter((candidate) => candidate.id !== input.dayId).map((candidate, index) => ({ ...candidate, index })),
      items: stored.trip.items.filter((item) => item.dayId !== input.dayId),
      tasks: stored.trip.tasks.filter((task) => task.dayId !== input.dayId),
      segments: stored.trip.segments.filter((segment) => segment.dayId !== input.dayId && !dayItemIds.has(segment.fromItemId) && !dayItemIds.has(segment.toItemId)),
    };
    // The trips list and the trip header render the span from startDate and
    // endDate — deleting the first or last day would otherwise leave a range
    // that advertises days that no longer exist.
    if (trip.days.length) {
      const dates = trip.days.map((day) => day.date).sort();
      trip = { ...trip, startDate: dates[0]!, endDate: dates[dates.length - 1]! };
    }
    trip = recomputeTrip(trip);
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async proposeChange(raw: unknown) {
    const input = proposeChangeInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");

    const transportContext = transportContextFromInstruction(input.instruction, stored.trip);
    if (transportContext) {
      const requestedTransportDay = input.dayId
        ?? resolveRequestedDay(stored.trip, input.instruction, currentDayId(stored.trip, input.asOf));
      const replanned = await this.replanTrip({
        tripId: input.tripId,
        dayId: requestedTransportDay,
        instruction: input.instruction,
        context: transportContext,
        fallbackPolicy: input.fallbackPolicy,
      }) as { data?: { proposalId?: string | null } };
      if (replanned.data?.proposalId) return replanned;
    }

    const provider = await this.providerFactory();
    const original = stored.trip;
    const locked = lockedItemIds(original);
    const fallbackDay = input.dayId ?? currentDayId(original, input.asOf);
    const working = structuredClone(original);
    let actionPlan = planActionsWithRules(working, input.instruction, fallbackDay);

    if (/雨|室内/.test(input.instruction)) {
      const dayId = resolveRequestedDay(working, input.instruction, fallbackDay);
      const target = working.items
        .filter((item) => item.dayId === dayId && item.status === "planned")
        .sort((a, b) => a.order - b.order)
        .find((item) => isOutdoor(working.places.find((place) => place.id === item.placeId)!));
      let indoor = working.places.find((place) => isIndoor(place) && !working.items.some((item) => item.placeId === place.id));
      if (!indoor) {
        const found = await provider.searchPlaces({ destination: working.destination, query: "室内 博物馆 美术馆", category: "activity", limit: 12 });
        indoor = found.find((place) => isIndoor(place)) ?? found[0];
        if (indoor) working.places.push(indoor);
      }
      if (dayId && target && indoor) actionPlan = { actions: [{ type: "REPLACE_ITEM", payload: { itemId: target.id, placeId: indoor.id } }], summary: input.instruction };
    }

    const execution = executeActions(working, actionPlan.actions);
    if (!execution.applied.length) throw new SkillError("INVALID_INPUT", "No action could be applied", execution.rejected);
    const affectedDays = new Set<string>();
    for (const action of execution.applied) {
      const payload = action.payload as { dayId?: string; itemId?: string; toDayId?: string };
      const item = payload.itemId ? original.items.find((candidate) => candidate.id === payload.itemId) : undefined;
      if (payload.dayId) affectedDays.add(payload.dayId);
      if (payload.toDayId) affectedDays.add(payload.toDayId);
      if (item) affectedDays.add(item.dayId);
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
    const changeSet = computeTripChangeSet(original, proposed, execution.applied, actionPlan.summary);
    const { record: proposal, token } = await this.repository.saveProposal({
      tripId: original.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions: execution.applied,
      changeSet,
      proposedTrip: proposed,
    });
    return successEnvelope({ proposalId: proposal.id, proposalToken: token, tripId: original.id, baseRevision: proposal.baseRevision, actions: proposal.actions, changes: proposal.changeSet, summary: proposal.changeSet.summary }, status(placeLevel(provider), routeStatus, "UNKNOWN"), warnings);
  }

  async applyChange(raw: unknown) {
    if (!raw || typeof raw !== "object" || (raw as { confirmed?: unknown }).confirmed !== true) {
      throw new SkillError("CONFIRMATION_REQUIRED", "Explicit confirmed=true is required");
    }
    if (typeof (raw as { proposalToken?: unknown }).proposalToken !== "string") {
      throw new SkillError("PROPOSAL_TOKEN_REQUIRED", "proposalToken from propose-change is required to apply");
    }
    const input = applyChangeInputSchema.parse(raw);
    const stored = await this.repository.applyProposal(input);
    return successEnvelope({ tripId: input.tripId, proposalId: input.proposalId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
  }

  /**
   * Itinerary Optimizer v1: reschedules planned items into a geographically
   * clustered plan that respects day-part placement and the user's profile.
   * Always produces a proposal (Diff + proposalToken)
   * for the user to confirm — the optimizer never writes the trip directly.
   */
  async optimizeItinerary(raw: unknown) {
    const input = optimizeItineraryInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");

    const result = optimizeTripPlan({ trip: stored.trip });
    const optimizationEnvelope = {
      decisions: result?.optimization.decisions ?? [],
      warnings: result?.optimization.warnings ?? [],
      unresolvedConstraints: result?.optimization.unresolvedConstraints ?? [],
      estimatedWalkingMetersByDay: result?.optimization.metrics.estimatedWalkingMetersByDay ?? {},
    };
    if (!result || !result.changedDayIds.length) {
      return successEnvelope(
        {
          tripId: input.tripId,
          changed: false,
          message: result ? "当前安排已是优化器的最优解，未生成提案" : "没有可重排的 planned 行程项",
          optimization: optimizationEnvelope,
        },
        status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
      );
    }

    let proposed = result.trip;
    for (const dayId of result.changedDayIds) {
      proposed = recomputeDay(proposed, dayId);
    }
    const actions: TravelAction[] = result.changedDayIds.map((dayId) => ({ type: "OPTIMIZE_DAY" as const, payload: { dayId } }));
    const changeSet = computeTripChangeSet(stored.trip, proposed, actions, "智能排程优化：按地理位置聚类、时间窗与偏好重排");
    const { record: proposal, token } = await this.repository.saveProposal({
      tripId: stored.trip.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions,
      changeSet,
      proposedTrip: proposed,
    });
    return successEnvelope(
      {
        proposalId: proposal.id,
        proposalToken: token,
        tripId: input.tripId,
        baseRevision: proposal.baseRevision,
        actions,
        changes: changeSet,
        summary: changeSet.summary,
        optimization: optimizationEnvelope,
      },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    );
  }

  /**
   * Trust replan: converts validation issues (closed place, rainy-day outdoor
   * stops, duplicates, missing meals, over-long hops, budget overrun) into a
   * deterministic Diff proposal. Alternatives come only from the trip's
   * existing candidate pool — nothing is invented, and nothing writes until
   * the user confirms through apply-change.
   */
  async proposeTrustReplan(raw: unknown) {
    const input = proposeTrustReplanInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (input.expectedTripRevision !== undefined && stored.revision !== input.expectedTripRevision) {
      throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    }
    const profile = stored.trip.planningMetadata?.planningProfile;
    const before = buildTrustMetadata(stored.trip, profile);
    const plan = buildTrustReplan(stored.trip, {
      reason: input.reason,
      profile,
      ...(input.dayId ? { dayIds: [input.dayId] } : {}),
    });
    const baseSnapshotId = `${stored.trip.id}@${stored.revision}`;
    if (!plan.actions.length && !plan.segmentModes.length) {
      return successEnvelope({
        proposalId: null,
        tripId: stored.trip.id,
        baseRevision: stored.revision,
        baseSnapshotId,
        reason: input.reason,
        changes: null,
        trustChanges: [],
        beforeValidation: before.validation,
        validation: before.validation,
        requiresConfirmation: true,
        summary: plan.summary,
      });
    }

    const execution = executeActions(stored.trip, plan.actions);
    if (!execution.applied.length && !plan.segmentModes.length) {
      throw new SkillError("INVALID_INPUT", "No trust repair could be applied", execution.rejected);
    }
    const labels: Partial<Record<RouteSegment["mode"], string>> = { walk: "步行", metro: "地铁", taxi: "出租", bus: "公交", drive: "自驾" };
    let proposed = execution.trip;
    if (plan.segmentModes.length) {
      const byKey = new Map(plan.segmentModes.map((change) => [`${change.dayId}|${change.fromPlaceId}|${change.toPlaceId}`, change.mode]));
      proposed = {
        ...proposed,
        segments: proposed.segments.map((segment) => {
          const mode = byKey.get(`${segment.dayId}|${segment.fromPlaceId}|${segment.toPlaceId}`);
          return mode ? { ...segment, mode, label: labels[mode] ?? segment.label } : segment;
        }),
      };
    }
    const changeSet = annotateChangeSetReasons(
      computeTripChangeSet(stored.trip, proposed, execution.applied, plan.summary),
      plan.changes,
      plan.segmentModes,
    );
    const { record: proposal, token } = await this.repository.saveProposal({
      tripId: stored.trip.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions: execution.applied,
      changeSet,
      proposedTrip: proposed,
    });
    const after = buildTrustMetadata(proposed, profile);
    return successEnvelope({
      proposalId: proposal.id,
      proposalToken: token,
      tripId: stored.trip.id,
      baseRevision: proposal.baseRevision,
      baseSnapshotId,
      reason: input.reason,
      changes: proposal.changeSet,
      trustChanges: plan.changes,
      beforeValidation: before.validation,
      validation: after.validation,
      requiresConfirmation: true,
      summary: plan.summary,
      rejectedActions: execution.rejected,
    });
  }

  /**
   * Today Mode v2: the execution console's single source of truth. Read-only;
   * deterministic rules only — lateness, remaining walking, next-hop
   * distance, weather — every suggestion maps to a user-initiated
   * propose-change, never a direct write.
   */
  async getTodayContext(raw: unknown) {
    const input = getTodayContextInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    let context;
    try {
      context = buildTodayContext(stored.trip, { dayId: input.dayId, asOf: input.asOf });
    } catch {
      throw new SkillError("TRIP_NOT_FOUND", "Trip has no days");
    }
    return successEnvelope(
      { tripId: input.tripId, ...context },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, context.weather?.provenance?.source === "amap" ? "REAL" : "UNKNOWN"),
      [],
      context.weather?.provenance ? { source: context.weather.provenance.source } : undefined,
    );
  }

  private tripDeps(): TripCommandDeps {
    return { repository: this.repository, providerFactory: this.providerFactory };
  }

  async getPlace(raw: unknown) {
    return getPlaceCommand(raw, this.tripDeps());
  }

  async updateTrip(raw: unknown) {
    return updateTripCommand(raw, this.tripDeps());
  }


  // ---------------------------------------------------------------------
  // Reservation domain (Phase 6.1): real-world commitments the itinerary
  // must respect. The runtime owns id/tripId/provenance; callers cannot
  // forge them. Writes are revision-locked like every other mutation.
  // ---------------------------------------------------------------------


  async addReservation(raw: unknown) {
    return addReservationCommand(raw, this.repository);
  }

  async updateReservation(raw: unknown) {
    return updateReservationCommand(raw, this.repository);
  }

  async removeReservation(raw: unknown) {
    return removeReservationCommand(raw, this.repository);
  }

  async getReservations(raw: unknown) {
    return getReservationsCommand(raw, this.repository);
  }

  /** Phase 6.2: the constraint engine's deterministic view of the trip. */
  async getConstraints(raw: unknown) {
    return getConstraintsCommand(raw, this.repository);
  }
  // ---------------------------------------------------------------------
  // TravelEvent domain (Phase 6.3): normalized real-world changes. Provider
  // responses are normalized BEFORE reaching this boundary; the runtime
  // labels provenance truthfully (simulation stays simulation).
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // TravelEvent domain: handlers live in
  // src/services/travel-events/commands.ts; these are thin adapters.
  // ---------------------------------------------------------------------

  private eventDeps(): TravelEventDeps {
    return { repository: this.repository, providerFactory: this.providerFactory };
  }

  async recordTravelEvent(raw: unknown) {
    return recordTravelEventCommand(raw, this.eventDeps());
  }

  async getActiveEvents(raw: unknown) {
    return getActiveEventsCommand(raw, this.eventDeps());
  }

  /** Phase 6.4: deterministic execution state — no LLM, no providers. */
  async getTripStateView(raw: unknown) {
    return getTripStateViewCommand(raw, this.eventDeps());
  }

  /** Phase 6.5: read-only impact analysis of one event. */
  async analyzeEventImpactView(raw: unknown) {
    return analyzeEventImpactViewCommand(raw, this.eventDeps());
  }

  /**
   * Phase 6.6: event-driven replan. TripState → Impact → deterministic
   * actions → the standard proposal pipeline.
   */
  async proposeEventReplan(raw: unknown) {
    return proposeEventReplanCommand(raw, this.eventDeps());
  }

  /** Phase 6.8: inject a scripted incident (demo/dev only). */
  async simulateTravelEvent(raw: unknown) {
    return simulateTravelEventCommand(raw, this.eventDeps());
  }


  // ---------------------------------------------------------------------
  // Traveler memory (Phase 6.9): conservative, explicit-first preference
  // records. Workspace-scoped; every consumer must disclose usage.
  // ---------------------------------------------------------------------

  private memoryDeps(): MemoryCommandDeps {
    return { dataRoot: this.repository.dataRoot };
  }

  async getTravelerMemory(raw: unknown) {
    return getTravelerMemoryCommand(raw, this.memoryDeps());
  }

  async updateTravelerMemory(raw: unknown) {
    return updateTravelerMemoryCommand(raw, this.memoryDeps());
  }

  async deleteTravelerMemory(raw: unknown) {
    return deleteTravelerMemoryCommand(raw, this.memoryDeps());
  }

  async disableTravelerMemory(raw: unknown) {
    return disableTravelerMemoryCommand(raw, this.memoryDeps());
  }


  async importReservations(raw: unknown) {
    return importReservationsCommand(raw, this.repository);
  }

  private socialDeps(): SocialCommandDeps {
    return {
      repository: this.repository,
      providerFactory: this.providerFactory,
      socialRouterFactory: this.socialRouterFactory,
    };
  }

  async searchSocial(raw: unknown) {
    return searchSocialCommand(raw, this.socialDeps());
  }

  async getSocialTrending(raw: unknown) {
    return getSocialTrendingCommand(raw, this.socialDeps());
  }

  async getSocialEvidence(raw: unknown) {
    return getSocialEvidenceCommand(raw, this.socialDeps());
  }


  async execute(command: SkillCommand, input: unknown) {
    switch (command) {
      case "create-trip": return this.createTrip(input);
      case "get-trip": return this.getTrip(input);
      case "search-places": return this.searchPlaces(input);
      case "plan-route": return this.planRoute(input);
      case "get-route-options": return this.getRouteOptions(input);
      case "optimize-transport": return this.optimizeTransport(input);
      case "retrieve-travel-knowledge": return this.retrieveTravelKnowledge(input);
      case "replan-trip": return this.replanTrip(input);
      case "get-weather": return this.getWeather(input);
      case "search-flights": return this.searchFlights(input);
      case "search-travel-offers": return this.searchTravelOffers(input);
      case "refresh-travel-offers": return this.refreshTravelOffers(input);
      case "reorder-day": return this.reorderDay(input);
      case "add-place-item": return this.addPlaceItem(input);
      case "set-item-status": return this.setItemStatus(input);
      case "remove-item": return this.removeItem(input);
      case "remove-day": return this.removeDay(input);
      case "add-place": return this.addPlace(input);
      case "restore-trip": return this.restoreTrip(input);
      case "import-route": return this.importRoute(input);
      case "set-task-status": return this.setTaskStatus(input);
      case "propose-change": return this.proposeChange(input);
      case "apply-change": return this.applyChange(input);
      case "optimize-itinerary": return this.optimizeItinerary(input);
      case "propose-trust-replan": return this.proposeTrustReplan(input);
      case "get-today-context": return this.getTodayContext(input);
      case "get-place": return this.getPlace(input);
      case "update-trip": return this.updateTrip(input);
      case "add-reservation": return this.addReservation(input);
      case "update-reservation": return this.updateReservation(input);
      case "remove-reservation": return this.removeReservation(input);
      case "get-reservations": return this.getReservations(input);
      case "get-constraints": return this.getConstraints(input);
      case "record-travel-event": return this.recordTravelEvent(input);
      case "get-active-events": return this.getActiveEvents(input);
      case "get-trip-state": return this.getTripStateView(input);
      case "analyze-event-impact": return this.analyzeEventImpactView(input);
      case "propose-event-replan": return this.proposeEventReplan(input);
      case "simulate-travel-event": return this.simulateTravelEvent(input);
      case "get-traveler-memory": return this.getTravelerMemory(input);
      case "update-traveler-memory": return this.updateTravelerMemory(input);
      case "delete-traveler-memory": return this.deleteTravelerMemory(input);
      case "disable-traveler-memory": return this.disableTravelerMemory(input);
      case "import-reservations": return this.importReservations(input);
      case "search-social": return this.searchSocial(input);
      case "get-social-trending": return this.getSocialTrending(input);
      case "get-social-evidence": return this.getSocialEvidence(input);
    }
  }
}

export function createRuntime(
  dataDir = process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage"),
  repositoryOptions: { proposalTtlSec?: number } = {},
) {
  return new VoyageSkillRuntime(new JsonSkillRepository(dataDir, repositoryOptions));
}
