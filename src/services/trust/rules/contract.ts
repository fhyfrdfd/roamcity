import type { PlanningProfile } from "@/schemas/planning";
import type { EvidenceCard, ValidationIssue } from "@/schemas/trust";
import type { Day, ItineraryItem, Place, Trip } from "@/types/travel";

export interface TrustRuleContext {
  trip: Trip;
  evidence: EvidenceCard[];
  profile?: PlanningProfile;
  maxTravelMinutes: number;
  walkingMinutesByTolerance: Partial<Record<"low" | "medium" | "high", number>>;
  accessibilityRequested: boolean;
  placeFor: (item: ItineraryItem) => Place | undefined;
  evidenceFor: (placeId?: string) => EvidenceCard[] | undefined;
  issue: (base: Omit<ValidationIssue, "severity">, severity: ValidationIssue["severity"]) => ValidationIssue;
}

/**
 * One file per rule, as required by the spec. A rule never mutates the trip;
 * it only reports facts for the validation report.
 */
export interface TrustRule {
  code: string;
  scope: "day" | "trip";
  evaluate: (context: TrustRuleContext, day?: Day) => ValidationIssue[];
}

export function itemsOfDay(trip: Trip, day: Day) {
  return trip.items.filter((item) => item.dayId === day.id).sort((a, b) => a.order - b.order);
}
