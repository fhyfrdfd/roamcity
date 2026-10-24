import type { PlanningProfile } from "@/schemas/planning";
import type { ItineraryItem, Trip } from "@/types/travel";
import type { EvidenceCard, ValidationIssue, ValidationReport } from "@/schemas/trust";
import { dayRules, tripRules, type TrustRuleContext } from "./rules";

export interface TrustValidationOptions {
  profile?: PlanningProfile;
  maxTravelMinutes?: number;
  walkingMinutesByTolerance?: Partial<Record<"low" | "medium" | "high", number>>;
  now?: Date;
}

function issue(base: Omit<ValidationIssue, "severity">, severity: ValidationIssue["severity"]): ValidationIssue {
  return { ...base, severity };
}

function evidenceFor(evidence: EvidenceCard[], placeId?: string) {
  return placeId ? evidence.filter((card) => card.placeId === placeId) : undefined;
}

function place(trip: Trip, item: ItineraryItem) {
  return trip.places.find((candidate) => candidate.id === item.placeId);
}

/** Deterministic trust gate. It never changes the trip; it only reports facts. */
export function validateTripTrust(trip: Trip, evidence: EvidenceCard[], options: TrustValidationOptions = {}): ValidationReport {
  const accessibility = options.profile?.accessibility;
  const context: TrustRuleContext = {
    trip,
    evidence,
    profile: options.profile,
    maxTravelMinutes: options.maxTravelMinutes ?? 60,
    walkingMinutesByTolerance: options.walkingMinutesByTolerance ?? { low: 90, medium: 150, high: 240 },
    accessibilityRequested: Array.isArray(accessibility) ? accessibility.length > 0 : accessibility === true,
    placeFor: (item) => place(trip, item),
    evidenceFor: (placeId) => evidenceFor(evidence, placeId),
    issue,
  };

  const issues: ValidationIssue[] = [];
  for (const day of trip.days) {
    for (const rule of dayRules) issues.push(...rule.evaluate(context, day));
  }
  for (const rule of tripRules) issues.push(...rule.evaluate(context));

  const errors = issues.filter((item) => item.severity === "error").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;
  const infos = issues.filter((item) => item.severity === "info").length;
  return {
    score: Math.max(0, Math.min(100, 100 - 25 * errors - 10 * warnings - 5 * infos)),
    passed: errors === 0,
    issues,
    generatedAt: (options.now ?? new Date()).toISOString(),
  };
}
