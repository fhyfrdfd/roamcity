import { accessibilityRiskRule } from "./accessibility-risk";
import { budgetExceededRule } from "./budget-exceeded";
import { closedAtArrivalRule } from "./closed-at-arrival";
import type { TrustRule } from "./contract";
import { dayOverloadedRule } from "./day-overloaded";
import { duplicateAcrossDaysRule } from "./duplicate-across-days";
import { duplicatePlaceRule } from "./duplicate-place";
import { missingMealRule } from "./missing-meal";
import { tooFewStopsRule } from "./too-few-stops";
import { travelTooLongRule } from "./travel-too-long";
import { unverifiedPlaceRule } from "./unverified-place";
import { walkingLimitRule } from "./walking-limit";
import { weatherRiskRule } from "./weather-risk";

/** Order matters: reports keep the historical rule order. */
export const dayRules: TrustRule[] = [
  tooFewStopsRule,
  duplicatePlaceRule,
  closedAtArrivalRule,
  missingMealRule,
  dayOverloadedRule,
  weatherRiskRule,
  accessibilityRiskRule,
];

export const tripRules: TrustRule[] = [
  duplicateAcrossDaysRule,
  travelTooLongRule,
  budgetExceededRule,
  walkingLimitRule,
  unverifiedPlaceRule,
];

export const allRules: TrustRule[] = [...dayRules, ...tripRules];

export * from "./contract";
