import { haversineMeters } from "@/lib/utils";
import type { PlanningProfile } from "@/schemas/planning";
import type { ReplanReason, TripChange } from "@/schemas/trust";
import type { TripChangeSet } from "@/types/diff";
import type { ItineraryItem, Place, RouteSegment, Trip } from "@/types/travel";
import type { TravelAction } from "@/services/ai/actions/types";
import { isAccessibilityRisk, isIndoorPlace, isOutdoorPlace, minutes, openingRange } from "./heuristics";

export interface TrustReplanOptions {
  reason?: ReplanReason;
  profile?: PlanningProfile;
  dayIds?: string[];
  maxTravelMinutes?: number;
}

export interface SegmentModeChange {
  dayId: string;
  fromPlaceId: string;
  toPlaceId: string;
  mode: RouteSegment["mode"];
  reason: ReplanReason;
}

export interface TrustReplanPlan {
  actions: TravelAction[];
  changes: TripChange[];
  segmentModes: SegmentModeChange[];
  summary: string;
}

const WALKING_LIMITS = { low: 90, medium: 150, high: 240 } as const;

function dayItems(trip: Trip, dayId: string) {
  return trip.items.filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
}

function placeOf(trip: Trip, placeId: string) {
  return trip.places.find((place) => place.id === placeId);
}

function costOf(place?: Place) {
  return place?.estimatedCost ?? 0;
}

function isOpenAt(place: Place, at: number) {
  if (place.openingStatus === "closed") return false;
  const range = openingRange(place.openingHours);
  if (!range) return true;
  return at >= range.start && at <= range.end;
}

interface AlternativeQuery {
  excludePlaceId?: string;
  categories?: Place["category"][];
  indoor?: boolean;
  openAt?: number;
  cheaperThan?: number;
  near?: Place;
  maxDistanceM?: number;
}

function pickAlternative(trip: Trip, used: Set<string>, query: AlternativeQuery): Place | undefined {
  const candidates = trip.places.filter((place) => {
    if (used.has(place.id) || place.id === query.excludePlaceId) return false;
    if (query.categories && !query.categories.includes(place.category)) return false;
    if (query.indoor && !isIndoorPlace(place)) return false;
    if (query.openAt !== undefined && !isOpenAt(place, query.openAt)) return false;
    if (query.cheaperThan !== undefined && (costOf(place) <= 0 || costOf(place) >= query.cheaperThan)) return false;
    if (query.near && query.maxDistanceM !== undefined && haversineMeters(query.near, place) > query.maxDistanceM) return false;
    return true;
  });
  candidates.sort((a, b) => {
    if (query.near) {
      const distance = haversineMeters(query.near, a) - haversineMeters(query.near, b);
      if (Math.abs(distance) > 1) return distance;
    }
    return b.rating - a.rating || a.id.localeCompare(b.id);
  });
  return candidates[0];
}

function summarize(changes: TripChange[]) {
  const labels: Record<ReplanReason, string> = {
    PLACE_CLOSED: "闭馆",
    WEATHER: "天气",
    TRAVEL_TOO_LONG: "交通超时",
    BUDGET: "预算",
    WALKING_LIMIT: "步行",
    ACCESSIBILITY: "无障碍",
    CROWD: "拥挤",
    USER_REQUEST: "整理",
  };
  const counts = new Map<ReplanReason, number>();
  for (const change of changes) counts.set(change.reason, (counts.get(change.reason) ?? 0) + 1);
  const parts = [...counts.entries()].map(([reason, count]) => `${labels[reason]} ${count} 项`);
  return parts.length ? `自动修复 ${changes.length} 项：${parts.join("、")}` : "没有可自动修复的问题";
}

/**
 * Deterministic trust repair planner. It only reuses places that already exist
 * in the trip's candidate pool — alternatives are never invented. The plan is a
 * proposal: the caller persists it and a human confirms before anything writes.
 */
export function buildTrustReplan(trip: Trip, options: TrustReplanOptions = {}): TrustReplanPlan {
  const fallbackReason = options.reason ?? "USER_REQUEST";
  const days = options.dayIds ? trip.days.filter((day) => options.dayIds?.includes(day.id)) : trip.days;
  const maxTravelMinutes = options.maxTravelMinutes ?? 60;
  const accessibility = options.profile?.accessibility;
  const accessibilityRequested = Array.isArray(accessibility) ? accessibility.length > 0 : accessibility === true;
  const used = new Set(trip.items.map((item) => item.placeId));
  const actions: TravelAction[] = [];
  const changes: TripChange[] = [];
  const segmentModes: SegmentModeChange[] = [];
  const handled = new Set<string>();
  const addedByDay = new Map<string, ItineraryItem[]>();
  const currentPlace = new Map<string, Place | undefined>(trip.items.map((item) => [item.id, placeOf(trip, item.placeId)]));

  const remove = (dayId: string, item: ItineraryItem, reason: ReplanReason) => {
    actions.push({ type: "REMOVE_ITEM", payload: { itemId: item.id } });
    changes.push({ type: "remove", dayId, fromItemId: item.id, fromPlaceId: item.placeId, reason });
    handled.add(item.id);
  };

  const replace = (dayId: string, item: ItineraryItem, place: Place, reason: ReplanReason) => {
    actions.push({ type: "REPLACE_ITEM", payload: { itemId: item.id, placeId: place.id } });
    changes.push({ type: "replace", dayId, fromItemId: item.id, toItemId: item.id, fromPlaceId: item.placeId, toPlaceId: place.id, reason });
    used.add(place.id);
    handled.add(item.id);
    currentPlace.set(item.id, place);
  };

  const mealCovered = (items: ItineraryItem[]) => items.some((item) => {
    if (item.meal === "lunch" || item.meal === "dinner") return true;
    const place = currentPlace.get(item.id);
    const start = minutes(item.startTime);
    return place?.category === "food" && ((start >= 11 * 60 && start < 15 * 60) || (start >= 17 * 60 && start < 22 * 60));
  });

  for (const day of days) {
    const items = dayItems(trip, day.id);
    const first = items[0];
    const seen = new Set<string>();

    for (const item of items) {
      if (!seen.has(item.placeId)) {
        seen.add(item.placeId);
        continue;
      }
      const current = placeOf(trip, item.placeId);
      const alternative = pickAlternative(trip, used, {
        excludePlaceId: item.placeId,
        categories: current ? [current.category] : undefined,
        openAt: minutes(item.startTime),
        near: placeOf(trip, items[Math.max(0, items.indexOf(item) - 1)]?.placeId ?? ""),
      });
      if (alternative) replace(day.id, item, alternative, fallbackReason);
      else remove(day.id, item, fallbackReason);
    }

    for (const item of items) {
      if (handled.has(item.id)) continue;
      const place = currentPlace.get(item.id);
      if (!place) continue;
      const range = openingRange(place.openingHours);
      const start = minutes(item.startTime);
      if (place.openingStatus !== "closed" && (!range || (start >= range.start && start <= range.end))) continue;
      if (place.openingStatus !== "closed" && item.id === first?.id && range && range.start + 5 <= range.end) {
        const startTime = `${String(Math.floor((range.start + 5) / 60)).padStart(2, "0")}:${String((range.start + 5) % 60).padStart(2, "0")}`;
        actions.push({ type: "CHANGE_TIME", payload: { itemId: item.id, startTime } });
        changes.push({ type: "retime", dayId: day.id, fromItemId: item.id, fromPlaceId: item.placeId, reason: "PLACE_CLOSED" });
        handled.add(item.id);
        continue;
      }
      const alternative = pickAlternative(trip, used, {
        excludePlaceId: item.placeId,
        categories: [place.category],
        openAt: start,
        near: placeOf(trip, items[Math.max(0, items.indexOf(item) - 1)]?.placeId ?? ""),
      });
      if (alternative) replace(day.id, item, alternative, "PLACE_CLOSED");
    }

    if (!mealCovered(items)) {
      const anchor = items.at(-1) ? placeOf(trip, items.at(-1)!.placeId) : undefined;
      const food = pickAlternative(trip, used, { categories: ["food"], openAt: 12 * 60, near: anchor }) ?? pickAlternative(trip, used, { categories: ["food"] });
      if (food) {
        actions.push({ type: "ADD_ITEM", payload: { placeId: food.id, dayId: day.id, startTime: "12:00", durationMinutes: food.stayMinutes || 60, meal: "lunch" } });
        changes.push({ type: "add", dayId: day.id, toPlaceId: food.id, reason: fallbackReason });
        used.add(food.id);
        const added: ItineraryItem = { id: `planned-${food.id}`, dayId: day.id, type: "food", placeId: food.id, startTime: "12:00", duration: food.stayMinutes || 60, order: items.length, status: "planned", meal: "lunch" };
        addedByDay.set(day.id, [...(addedByDay.get(day.id) ?? []), added]);
      }
    }

    const planned = [...items, ...(addedByDay.get(day.id) ?? [])];
    let lastPlace = planned.at(-1) ? placeOf(trip, planned.at(-1)!.placeId) : undefined;
    while (planned.length < 3) {
      const alternative = pickAlternative(trip, used, { categories: ["attraction"], near: lastPlace }) ?? pickAlternative(trip, used, { near: lastPlace });
      if (!alternative) break;
      actions.push({ type: "ADD_ITEM", payload: { placeId: alternative.id, dayId: day.id, startTime: "15:00", durationMinutes: alternative.stayMinutes || 60 } });
      changes.push({ type: "add", dayId: day.id, toPlaceId: alternative.id, reason: fallbackReason });
      used.add(alternative.id);
      planned.push({ id: `planned-${alternative.id}`, dayId: day.id, type: "place", placeId: alternative.id, startTime: "15:00", duration: alternative.stayMinutes || 60, order: planned.length, status: "planned" });
      lastPlace = alternative;
    }

    if (/雨|暴雨|雷|高温|酷热/.test(day.weather.condition)) {
      for (const item of items) {
        if (handled.has(item.id)) continue;
        const place = currentPlace.get(item.id);
        if (!place || !isOutdoorPlace(place)) continue;
        const alternative = pickAlternative(trip, used, {
          excludePlaceId: item.placeId,
          indoor: true,
          openAt: minutes(item.startTime),
          near: placeOf(trip, items[Math.max(0, items.indexOf(item) - 1)]?.placeId ?? ""),
        });
        if (alternative) replace(day.id, item, alternative, "WEATHER");
      }
    }

    if (accessibilityRequested) {
      for (const item of items) {
        if (handled.has(item.id)) continue;
        const place = currentPlace.get(item.id);
        if (!place || !isAccessibilityRisk(place)) continue;
        const alternative = pickAlternative(trip, used, {
          excludePlaceId: item.placeId,
          categories: [place.category],
          openAt: minutes(item.startTime),
          near: placeOf(trip, items[Math.max(0, items.indexOf(item) - 1)]?.placeId ?? ""),
        });
        const safer = alternative && !isAccessibilityRisk(alternative) ? alternative : undefined;
        if (safer) replace(day.id, item, safer, "ACCESSIBILITY");
      }
    }
  }

  for (const day of days) {
    const items = dayItems(trip, day.id);
    for (const segment of trip.segments.filter((candidate) => candidate.dayId === day.id)) {
      const duration = segment.durationMinutes ?? segment.minutes;
      if (duration <= maxTravelMinutes) continue;
      const item = items.find((candidate) => candidate.id === segment.toItemId);
      if (!item || handled.has(item.id)) continue;
      const destination = placeOf(trip, segment.toPlaceId);
      const origin = placeOf(trip, segment.fromPlaceId);
      const alternative = destination && pickAlternative(trip, used, {
        excludePlaceId: destination.id,
        categories: [destination.category],
        openAt: minutes(item.startTime),
        near: origin,
        maxDistanceM: Math.max(1500, Math.round(duration * 60)),
      });
      if (alternative) replace(day.id, item, alternative, "TRAVEL_TOO_LONG");
    }
  }

  const plannedSpend = trip.budgetItems.reduce((sum, item) => sum + item.planned, 0) || trip.estimatedSpend;
  if (trip.budget > 0 && plannedSpend > trip.budget) {
    const over = Math.round(plannedSpend - trip.budget);
    const paid = trip.items
      .filter((item) => !handled.has(item.id) && costOf(placeOf(trip, item.placeId)) > 0)
      .sort((a, b) => costOf(placeOf(trip, b.placeId)) - costOf(placeOf(trip, a.placeId)));
    for (const item of paid.slice(0, 3)) {
      const place = placeOf(trip, item.placeId);
      if (!place) continue;
      const alternative = pickAlternative(trip, used, {
        excludePlaceId: place.id,
        categories: [place.category],
        cheaperThan: costOf(place),
        openAt: minutes(item.startTime),
      });
      if (alternative) replace(item.dayId, item, alternative, "BUDGET");
    }
    actions.push({ type: "REDUCE_BUDGET", payload: { amount: over, reason: "超预算自动压缩" } });
    changes.push({ type: "budget", dayId: days[0]?.id ?? trip.days[0]?.id ?? trip.id, reason: "BUDGET" });
  }

  const firstDayOfPlace = new Map<string, string>();
  for (const item of trip.items) {
    const prior = firstDayOfPlace.get(item.placeId);
    if (prior && prior !== item.dayId && !handled.has(item.id)) {
      const place = placeOf(trip, item.placeId);
      const alternative = place ? pickAlternative(trip, used, {
        excludePlaceId: place.id,
        categories: [place.category],
        openAt: minutes(item.startTime),
      }) : undefined;
      if (alternative) replace(item.dayId, item, alternative, fallbackReason);
      else remove(item.dayId, item, fallbackReason);
    } else if (!prior) {
      firstDayOfPlace.set(item.placeId, item.dayId);
    }
  }

  const tolerance = options.profile?.walkingTolerance;
  if (tolerance) {
    let walking = trip.segments.filter((segment) => segment.mode === "walk").reduce((sum, segment) => sum + (segment.durationMinutes ?? segment.minutes), 0);
    const limit = WALKING_LIMITS[tolerance];
    if (walking > limit) {
      const walkSegments = trip.segments
        .filter((segment) => segment.mode === "walk")
        .sort((a, b) => (b.durationMinutes ?? b.minutes) - (a.durationMinutes ?? a.minutes));
      for (const segment of walkSegments) {
        if (walking <= limit) break;
        const duration = segment.durationMinutes ?? segment.minutes;
        if (duration < 15 || segmentModes.some((change) => change.dayId === segment.dayId && change.fromPlaceId === segment.fromPlaceId && change.toPlaceId === segment.toPlaceId)) continue;
        segmentModes.push({
          dayId: segment.dayId,
          fromPlaceId: segment.fromPlaceId,
          toPlaceId: segment.toPlaceId,
          mode: segment.distanceMeters > 3000 ? "taxi" : "metro",
          reason: "WALKING_LIMIT",
        });
        walking -= duration;
      }
    }
  }

  return { actions, changes, segmentModes, summary: summarize(changes) };
}

/** Attaches the trigger reason to each diff row so the modal can show "why". */
export function annotateChangeSetReasons(changeSet: TripChangeSet, changes: TripChange[], segmentModes: SegmentModeChange[] = []): TripChangeSet {
  const byItem = new Map<string, ReplanReason>();
  const byPlace = new Map<string, ReplanReason>();
  for (const change of changes) {
    if (change.fromItemId) byItem.set(change.fromItemId, change.reason);
    if (change.toItemId) byItem.set(change.toItemId, change.reason);
    if (change.fromPlaceId) byPlace.set(change.fromPlaceId, change.reason);
    if (change.toPlaceId) byPlace.set(change.toPlaceId, change.reason);
  }
  const itemChanges = changeSet.itemChanges.map((change) => {
    let reason = change.itemId ? byItem.get(change.itemId) : undefined;
    if (!reason && change.itemId) {
      const item = changeSet.proposedTrip.items.find((candidate) => candidate.id === change.itemId)
        ?? changeSet.beforeTrip.items.find((candidate) => candidate.id === change.itemId);
      if (item) reason = byPlace.get(item.placeId);
    }
    if (!reason) {
      const place = [...changeSet.proposedTrip.places, ...changeSet.beforeTrip.places].find((candidate) => candidate.name === change.placeName);
      if (place) reason = byPlace.get(place.id);
    }
    return reason ? { ...change, reason } : change;
  });
  const transitChanges = changeSet.metrics.transitChanges.map((change) => {
    const segment = segmentModes.find((candidate) => {
      const from = changeSet.beforeTrip.places.find((place) => place.id === candidate.fromPlaceId);
      const to = changeSet.beforeTrip.places.find((place) => place.id === candidate.toPlaceId);
      return from?.name === change.fromPlaceName && to?.name === change.toPlaceName;
    });
    return segment ? { ...change, reason: segment.reason } : change;
  });
  return { ...changeSet, itemChanges, metrics: { ...changeSet.metrics, transitChanges } };
}
