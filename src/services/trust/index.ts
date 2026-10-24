import type { PlanningProfile } from "@/schemas/planning";
import type { Trip } from "@/types/travel";
import { buildEvidenceCards } from "./evidence";
import { validateTripTrust } from "./validator";

export function buildTrustMetadata(trip: Trip, profile?: PlanningProfile, fetchedAt?: string) {
  const refreshed = buildEvidenceCards(trip, fetchedAt);
  const previousFetchedAt = new Map((trip.trust?.evidence ?? []).map((card) => [card.placeId, card.fetchedAt]));
  const evidence = refreshed.map((card) => ({ ...card, fetchedAt: previousFetchedAt.get(card.placeId) ?? card.fetchedAt }));
  return { evidence, validation: validateTripTrust(trip, evidence, { profile }) };
}

export { buildCandidateSet } from "./candidates";
export { buildEvidenceCards } from "./evidence";
export { validateTripTrust } from "./validator";
export { allRules, dayRules, tripRules } from "./rules";
export type { TrustRule, TrustRuleContext } from "./rules";
export { repairOutlineForTrust } from "./repair";
export { annotateChangeSetReasons, buildTrustReplan } from "./replan";
export type { SegmentModeChange, TrustReplanOptions, TrustReplanPlan } from "./replan";
export type * from "@/schemas/trust";
