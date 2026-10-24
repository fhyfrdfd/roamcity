/**
 * Trust-replan evaluation: Voyage pipeline vs a pure-LLM baseline.
 *
 * Shared by the `npm run eval:trust` CLI (benchmarks/eval/trust/run.ts) and the
 * dev-only POST /api/voyage/evaluate endpoint.
 *
 * Pipeline: real AMap candidate retrieval -> LLM outline -> deterministic trust
 * repair -> validation -> propose/apply replan. Every stop carries AMap
 * provenance; validation issues are computed by the same validator the product
 * ships.
 *
 * Baseline: one LLM call with the same user prompt and no candidate pool, no
 * map, no validator. Its places are then verified against AMap by name so
 * "did the model invent places?" is measured, not assumed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";
import { createRuntime } from "@/skill/runtime";
import { providerFromEnvironment, type TravelDataProvider } from "@/skill/providers";
import { chatJson, getLlmConfig, type ChatMessage } from "@/services/ai/llm";
import { planningProfileToPrompt } from "@/services/planning/profile";
import { planningProfileSchema, type PlanningProfile } from "@/schemas/planning";
import { validateTripTrust } from "@/services/trust";
import type { ValidationReport } from "@/schemas/trust";
import type { Day, ItineraryItem, Place, RouteSegment, Trip } from "@/types/travel";

export interface TrustEvaluationOptions {
  /** Repository root; task dataset and report paths resolve from here. */
  rootDir?: string;
  /** Explicit tasks; when omitted the dataset under benchmarks/eval/trust/tasks.json is used. */
  tasks?: TaskSpec[];
  /** Restrict to these task ids. */
  only?: string[];
  /** Maximum number of tasks to run. */
  limit?: number;
  verbose?: boolean;
  skipBaseline?: boolean;
  checkBaselineRoutes?: boolean;
  /** Write report.json / report.md / eval-trust.json. The HTTP endpoint keeps this off. */
  persist?: boolean;
  /** Suppress CLI progress logs. */
  quiet?: boolean;
}

const DEFAULT_ROOT = process.cwd();



function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function elapsedMs(start: number) {
  return Math.round(Date.now() - start);
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

const constraintsSchema = z.object({
  days: z.number().int().min(1).max(7),
  travelers: z.number().int().min(1).max(20),
  budget: z.number().min(0),
  walkingTolerance: z.enum(["low", "medium", "high"]).optional(),
  pace: z.enum(["relaxed", "balanced", "packed"]).optional(),
  transportPreference: z.enum(["mixed", "public", "metro", "bus", "taxi", "drive", "walk"]).optional(),
  vibes: z.array(z.string()).default([]),
  mustVisit: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  dietary: z.array(z.string()).default([]),
  elderly: z.union([z.boolean(), z.number().int().min(0).max(20)]).optional(),
  children: z.union([z.boolean(), z.number().int().min(0).max(20)]).optional(),
  budgetMode: z.enum(["tight", "balanced", "flexible"]).optional(),
});

const expectSchema = z.object({
  days: z.number().int().min(1).max(7),
  minStopsPerDay: z.number().int().min(1),
  mustHaveMeal: z.boolean(),
  maxTravelMinutes: z.number().min(1),
  noDuplicatePlace: z.boolean(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  city: z.string().min(1),
  prompt: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  constraints: constraintsSchema,
  expect: expectSchema,
});

export type TaskSpec = z.output<typeof taskSchema>;
type TaskExpect = z.output<typeof expectSchema>;

function loadTasks(evalDir: string, options: TrustEvaluationOptions): TaskSpec[] {
  const raw = JSON.parse(readFileSync(path.join(evalDir, "tasks.json"), "utf8")) as { cases?: unknown };
  const cases = z.array(taskSchema).parse(raw.cases);
  return cases
    .filter((task) => !options.only || options.only.includes(task.id))
    .slice(0, options.limit ?? cases.length);
}

function profileFor(task: TaskSpec): PlanningProfile {
  const { days, travelers, budget, walkingTolerance, pace, transportPreference, vibes, mustVisit, avoid, dietary, elderly, children, budgetMode } = task.constraints;
  return planningProfileSchema.parse({
    destination: task.city,
    days,
    travelers,
    budget,
    ...(walkingTolerance ? { walkingTolerance } : {}),
    ...(pace ? { pace } : {}),
    ...(transportPreference ? { transportPreference } : {}),
    vibes,
    mustVisit,
    avoid,
    dietary,
    ...(elderly !== undefined ? { elderly } : {}),
    ...(children !== undefined ? { children } : {}),
    ...(budgetMode ? { budgetMode } : {}),
    socialOptIn: false,
    includeExternalOffers: false,
  });
}

function addDays(iso: string, days: number) {
  return new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Shared metric shapes
// ---------------------------------------------------------------------------

interface Fact {
  real: boolean;
  addressPresent: boolean;
}

interface CaseMetrics {
  days: number;
  totalStops: number;
  stopsByDay: number[];
  duplicateItems: number;
  duplicateRate: number;
  crossDayDuplicateItems: number;
  mealDays: number;
  mealCoverage: number;
  factualStops: number;
  factualAccuracy: number;
  addressStops: number;
  addressRate: number;
  maxTravelMinutes: number | null;
  travelAssessed: boolean;
  severeTravel: boolean;
  validation: {
    score: number;
    passed: boolean;
    errors: number;
    warnings: number;
    codes: Record<string, number>;
  };
  estimatedSpend: number;
  budget: number;
  budgetWithinCap: boolean;
  constraintFailures: string[];
  constraintsPassed: boolean;
}

interface RepairResult {
  attempted: boolean;
  success: boolean | null;
  ms: number;
  beforeIssues: number;
  afterIssues: number | null;
  inventedPlaces: string[];
  note?: string;
  error?: string;
}

interface CaseResult {
  id: string;
  city: string;
  prompt: string;
  pipeline?: {
    ms: number;
    tripId: string;
    revision: number;
    metrics: CaseMetrics;
    warnings: string[];
    repair: RepairResult;
  };
  baseline?: {
    ms: number;
    plan: BaselinePlan;
    metrics: CaseMetrics;
    unverifiedNames: string[];
    unknownTravelHops: number;
    repair: RepairResult;
  };
  errorPipeline?: string;
  errorBaseline?: string;
}

function computeMetrics(input: {
  trip: Trip;
  validation: ValidationReport;
  expected: TaskExpect;
  reportedDays: number;
  facts: Map<string, Fact>;
  maxTravelMinutes: number | null;
  travelAssessed: boolean;
}): CaseMetrics {
  const { trip, validation, expected, reportedDays, facts, maxTravelMinutes, travelAssessed } = input;
  const totalStops = trip.items.length;
  const expectedDays = trip.days.slice(0, expected.days);
  const stopsByDay = expectedDays.map((day) => trip.items.filter((item) => item.dayId === day.id).length);

  let duplicateItems = 0;
  for (const day of expectedDays) {
    const items = trip.items.filter((item) => item.dayId === day.id);
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.placeId, (counts.get(item.placeId) ?? 0) + 1);
    for (const count of counts.values()) duplicateItems += Math.max(0, count - 1);
  }

  const firstDayByPlace = new Map<string, string>();
  let crossDayDuplicateItems = 0;
  for (const item of trip.items) {
    const firstDay = firstDayByPlace.get(item.placeId);
    if (firstDay && firstDay !== item.dayId) crossDayDuplicateItems += 1;
    else if (!firstDay) firstDayByPlace.set(item.placeId, item.dayId);
  }

  const mealDays = expectedDays.filter((day) => {
    const items = trip.items.filter((item) => item.dayId === day.id);
    return items.some((item) => {
      if (item.meal === "lunch" || item.meal === "dinner") return true;
      const place = trip.places.find((candidate) => candidate.id === item.placeId);
      const start = timeMinutes(item.startTime);
      return place?.category === "food" && ((start >= 11 * 60 && start < 15 * 60) || (start >= 17 * 60 && start < 22 * 60));
    });
  }).length;

  let factualStops = 0;
  let addressStops = 0;
  for (const item of trip.items) {
    const fact = facts.get(item.id);
    if (fact?.real) factualStops += 1;
    if (fact?.addressPresent) addressStops += 1;
  }

  const codes: Record<string, number> = {};
  for (const issue of validation.issues) codes[issue.code] = (codes[issue.code] ?? 0) + 1;
  const errors = validation.issues.filter((issue) => issue.severity === "error").length;
  const warnings = validation.issues.filter((issue) => issue.severity === "warning").length;

  const failures: string[] = [];
  if (reportedDays !== expected.days) failures.push(`days ${reportedDays} != ${expected.days}`);
  if (expectedDays.some((_, index) => (stopsByDay[index] ?? 0) < expected.minStopsPerDay)) {
    failures.push(`stops/day below ${expected.minStopsPerDay}`);
  }
  if (expected.mustHaveMeal && mealDays < expectedDays.length) failures.push("missing meal on some day");
  if (expected.noDuplicatePlace && duplicateItems > 0) failures.push(`duplicate places within day: ${duplicateItems}`);
  if (maxTravelMinutes !== null && maxTravelMinutes > expected.maxTravelMinutes) {
    failures.push(`travel ${maxTravelMinutes}min > ${expected.maxTravelMinutes}min`);
  }

  const planned = trip.budgetItems.reduce((sum, item) => sum + item.planned, 0) || trip.estimatedSpend;
  const budgetWithinCap = trip.budget <= 0 || planned <= trip.budget;
  if (!budgetWithinCap) failures.push(`budget ${Math.round(planned)} > ${trip.budget}`);

  return {
    days: reportedDays,
    totalStops,
    stopsByDay,
    duplicateItems,
    duplicateRate: totalStops ? duplicateItems / totalStops : 0,
    crossDayDuplicateItems,
    mealDays,
    mealCoverage: expectedDays.length ? mealDays / expectedDays.length : 0,
    factualStops,
    factualAccuracy: totalStops ? factualStops / totalStops : 0,
    addressStops,
    addressRate: totalStops ? addressStops / totalStops : 0,
    maxTravelMinutes,
    travelAssessed,
    severeTravel: maxTravelMinutes !== null && maxTravelMinutes > expected.maxTravelMinutes * 2,
    validation: { score: validation.score, passed: validation.passed, errors, warnings, codes },
    estimatedSpend: planned,
    budget: trip.budget,
    budgetWithinCap,
    constraintFailures: failures,
    constraintsPassed: failures.length === 0,
  };
}

// ---------------------------------------------------------------------------
// AMap name verification (baseline factuality) and route measurement
// ---------------------------------------------------------------------------

function normalizeName(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function nameMatches(candidate: string, query: string) {
  const left = normalizeName(candidate);
  const right = normalizeName(query);
  if (!left || !right) return false;
  if (left === right) return true;
  if (right.length >= 3 && left.length <= right.length + 10 && (left.includes(right) || right.includes(left))) return true;
  if (right.length === 2 && left.startsWith(right)) return true;
  return false;
}

interface Verification {
  verified: boolean;
  matchedName?: string;
  address?: string;
  lat?: number;
  lng?: number;
  error?: string;
}

class PlaceVerifier {
  private cache = new Map<string, Verification>();

  constructor(private readonly provider: TravelDataProvider) {}

  async verify(city: string, name: string): Promise<Verification> {
    const key = `${city}|${normalizeName(name)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    await sleep(320);
    let results: Place[] = [];
    let error: string | undefined;
    try {
      results = await this.provider.searchPlaces({ destination: city, query: name, limit: 5 });
    } catch (first) {
      await sleep(700);
      try {
        results = await this.provider.searchPlaces({ destination: city, query: name, limit: 5 });
      } catch (second) {
        error = second instanceof Error ? second.message : String(second ?? first);
      }
    }
    const match = results.find((place) => nameMatches(place.name, name));
    const verification: Verification = match
      ? { verified: true, matchedName: match.name, address: match.address, lat: match.lat, lng: match.lng }
      : { verified: false, ...(error ? { error } : {}) };
    this.cache.set(key, verification);
    return verification;
  }
}

class RouteMeasurer {
  private cache = new Map<string, { durationMinutes: number; distanceMeters: number } | undefined>();

  constructor(private readonly provider: TravelDataProvider) {}

  async measure(city: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: "walk" | "metro" | "bus" | "taxi" | "drive") {
    const key = `${city}|${mode}|${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    await sleep(320);
    let measured: { durationMinutes: number; distanceMeters: number } | undefined;
    try {
      const route = await this.provider.planRoute({ origin: from, destination: to, mode, city });
      measured = { durationMinutes: route.durationMinutes, distanceMeters: route.distanceMeters };
    } catch {
      measured = undefined;
    }
    this.cache.set(key, measured);
    return measured;
  }
}

function transportMode(profile: PlanningProfile): "walk" | "metro" | "bus" | "taxi" | "drive" {
  switch (profile.transportPreference) {
    case "metro":
    case "public":
      return "metro";
    case "bus":
      return "bus";
    case "taxi":
      return "taxi";
    case "drive":
      return "drive";
    default:
      return "walk";
  }
}

// ---------------------------------------------------------------------------
// Pure-LLM baseline
// ---------------------------------------------------------------------------

const baselineStopSchema = z.object({
  name: z.string().min(1),
  address: z.string().nullish(),
  category: z.string().nullish(),
  startTime: z.string().nullish(),
  durationMinutes: z.number().nullish(),
  estimatedCost: z.number().nullish(),
  meal: z.string().nullish(),
}).catchall(z.unknown());

const baselinePlanSchema = z.object({
  title: z.string().optional(),
  dayPlans: z.array(z.object({
    title: z.string().optional(),
    stops: z.array(baselineStopSchema).min(1),
  }).catchall(z.unknown())).min(1),
}).catchall(z.unknown());

type BaselinePlan = z.output<typeof baselinePlanSchema>;

const BASELINE_SYSTEM_PROMPT = [
  "你是「纯 LLM 旅行规划器」：没有地点数据库、没有地图、没有校验器，只能凭自己的知识规划。",
  '输出严格 JSON（不要 markdown 代码块）：{"title": "...", "dayPlans": [{"title": "...", "stops": [{"name": "真实地点名称", "address": "街道地址", "category": "attraction|food|cafe|activity|shopping|viewpoint|hotel", "startTime": "HH:mm", "durationMinutes": 60, "estimatedCost": 50, "meal": "lunch"}]}]}',
  "要求：",
  "1. dayPlans 的数量必须等于用户要求的天数；每天 3-4 个 stop，时间安排在 09:00-20:00 且先后合理。",
  "2. 每天至少一顿正餐（meal 为 lunch 或 dinner）。",
  "3. 同一天不要重复同一地点；整个行程也尽量不重复。",
  "4. 只写你确定真实存在的地点；不确定就不要写，绝不编造。",
  "5. estimatedCost 为该 stop 的人均花费（人民币整数）。",
  "6. address 写你确信的街道地址；不确定可以省略。",
].join("\n");

const REPAIR_SYSTEM_PROMPT = [
  "你是旅行行程修复器。用户给你一份 JSON 行程和校验问题列表。",
  "只输出修复后的同一结构 JSON，不要解释、不要 markdown。",
  "要求：逐条修复问题；不得用不存在的地点替换；天数不变；每天 3-4 个 stop 且有正餐；同一地点不重复。",
].join("\n");

async function generateBaseline(prompt: string): Promise<BaselinePlan> {
  const messages: ChatMessage[] = [
    { role: "system", content: BASELINE_SYSTEM_PROMPT },
    { role: "user", content: `${prompt}\n\n请严格按照系统消息的 JSON 结构给出行程。` },
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await chatJson({ messages, maxTokens: 4096, timeoutMs: 120_000 });
      return parseBaselinePlan(raw);
    } catch (error) {
      lastError = error;
      messages.push({ role: "user", content: "上次输出不是合法的行程 JSON。请只输出 JSON，不要解释。" });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("baseline generation failed");
}

function parseBaselinePlan(raw: unknown): BaselinePlan {
  const root = raw as Record<string, unknown>;
  const nested = root && typeof root.itinerary === "object" ? (root.itinerary as Record<string, unknown>) : undefined;
  const candidate = Array.isArray(root?.dayPlans) ? root : nested && Array.isArray(nested.dayPlans) ? nested : root;
  const parsed = baselinePlanSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`baseline JSON shape invalid: ${parsed.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).slice(0, 4).join("; ")}`);
  return parsed.data;
}

async function repairBaseline(plan: BaselinePlan, issues: string[]): Promise<BaselinePlan> {
  const messages: ChatMessage[] = [
    { role: "system", content: REPAIR_SYSTEM_PROMPT },
    {
      role: "user",
      content: `行程 JSON：\n${JSON.stringify(plan)}\n\n校验问题：\n${issues.map((issue) => `- ${issue}`).join("\n")}\n\n请输出修复后的 JSON。`,
    },
  ];
  const raw = await chatJson({ messages, maxTokens: 4096, timeoutMs: 120_000 });
  return parseBaselinePlan(raw);
}

function inferBaselineCategory(raw?: string | null): Place["category"] {
  const text = (raw ?? "").toLocaleLowerCase();
  if (/food|restaurant|餐|美食|小吃|火锅|面|饭|早茶/.test(text)) return "food";
  if (/cafe|咖啡|茶/.test(text)) return "cafe";
  if (/hotel|酒店|民宿|住宿/.test(text)) return "hotel";
  if (/shop|购物|商场|market/.test(text)) return "shopping";
  if (/activity|展览|演出|剧场|博物|美术馆|乐园/.test(text)) return "activity";
  if (/view|观景|夜景|山|湖|海/.test(text)) return "viewpoint";
  return "attraction";
}

function normalizeClock(value?: string | null) {
  if (!value) return "09:00";
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "09:00";
  const hour = Math.min(23, Number(match[1]));
  const minute = Math.min(59, Number(match[2]));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeMeal(value?: string | null): ItineraryItem["meal"] | undefined {
  if (!value) return undefined;
  const text = value.toLocaleLowerCase();
  if (/breakfast|早餐|早饭/.test(text)) return "breakfast";
  if (/lunch|午餐|午饭|中餐|正午/.test(text)) return "lunch";
  if (/dinner|晚餐|晚饭|晚宴/.test(text)) return "dinner";
  if (/snack|小吃|加餐|下午茶/.test(text)) return "snack";
  return undefined;
}

interface BaselineNormalized {
  trip: Trip;
  facts: Map<string, Fact>;
  unverifiedNames: string[];
  generatedDays: number;
}

async function normalizeBaseline(task: TaskSpec, plan: BaselinePlan, verifier: PlaceVerifier): Promise<BaselineNormalized> {
  const generatedDays = plan.dayPlans.length;
  const dayCount = Math.max(task.expect.days, generatedDays);
  const days: Day[] = Array.from({ length: dayCount }, (_, index) => ({
    id: `baseline-day-${index + 1}`,
    tripId: `baseline-${task.id}`,
    index,
    date: addDays(task.startDate, index),
    title: plan.dayPlans[index]?.title ?? `Day ${index + 1}`,
    summary: "",
    weather: { tempC: 22, condition: "天气未知", icon: "cloud" },
  }));

  const placesById = new Map<string, Place>();
  const items: ItineraryItem[] = [];
  const facts = new Map<string, Fact>();
  const unverified = new Set<string>();
  let order = 0;
  for (let dayIndex = 0; dayIndex < generatedDays; dayIndex += 1) {
    const stops = plan.dayPlans[dayIndex]?.stops ?? [];
    for (let stopIndex = 0; stopIndex < stops.length; stopIndex += 1) {
      const stop = stops[stopIndex];
      if (!stop) continue;
      const normalized = normalizeName(stop.name);
      const id = `llm-${createHash("sha1").update(normalized).digest("hex").slice(0, 10)}`;
      const verification = await verifier.verify(task.city, stop.name);
      if (!verification.verified) unverified.add(stop.name);
      const existing = placesById.get(id);
      if (!existing) {
        const category = inferBaselineCategory(stop.category);
        placesById.set(id, {
          id,
          name: stop.name,
          category,
          lat: verification.lat ?? 0,
          lng: verification.lng ?? 0,
          rating: 0,
          reviewCount: 0,
          image: "",
          priceLevel: 0,
          address: stop.address ?? verification.address ?? "",
          openingStatus: "unknown",
          stayMinutes: Math.max(15, Math.round(stop.durationMinutes ?? 60)),
          description: "",
          tags: [],
          district: "",
          ...(stop.estimatedCost != null ? { estimatedCost: stop.estimatedCost } : {}),
          source: "llm",
        });
      }
      const meal = normalizeMeal(stop.meal);
      const targetDay = days[Math.min(dayIndex, days.length - 1)];
      if (!targetDay) continue;
      const item: ItineraryItem = {
        id: `baseline-item-${items.length + 1}`,
        dayId: targetDay.id,
        type: inferBaselineCategory(stop.category) === "food" ? "food" : "place",
        placeId: id,
        startTime: normalizeClock(stop.startTime),
        duration: Math.max(15, Math.round(stop.durationMinutes ?? 60)),
        order: order++,
        status: "planned",
        ...(meal ? { meal } : {}),
      };      items.push(item);
      facts.set(item.id, { real: verification.verified, addressPresent: Boolean(stop.address ?? verification.address) });
    }
  }

  const estimatedSpend = plan.dayPlans
    .flatMap((day) => day.stops)
    .reduce((sum, stop) => sum + Math.max(0, stop.estimatedCost ?? 0), 0);

  const trip: Trip = {
    id: `baseline-${task.id}`,
    title: plan.title ?? `${task.city}纯 LLM 行程`,
    destination: task.city,
    origin: "",
    startDate: task.startDate,
    endDate: addDays(task.startDate, dayCount - 1),
    travelers: task.constraints.travelers,
    budget: task.constraints.budget,
    currency: "CNY",
    status: "ready",
    estimatedSpend,
    coverImage: "",
    vibe: task.constraints.vibes,
    prompt: task.prompt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    days,
    items,
    segments: [],
    places: [...placesById.values()],
    hotels: [],
    restaurants: [],
    activities: [],
    transports: [],
    tasks: [],
    budgetItems: [],
  };

  return {
    trip,
    facts,
    unverifiedNames: [...unverified],
    generatedDays,
  };
}

async function baselineTravelSegments(input: {
  task: TaskSpec;
  profile: PlanningProfile;
  normalized: BaselineNormalized;
  measurer: RouteMeasurer;
}): Promise<{ segments: RouteSegment[]; maxTravelMinutes: number | null; travelAssessed: boolean; unknownHops: number }> {
  const { task, profile, normalized, measurer } = input;
  const segments: RouteSegment[] = [];
  let peak = 0;
  let assessed = true;
  let unknownHops = 0;
  const mode = transportMode(profile);
  for (const day of normalized.trip.days.slice(0, task.expect.days)) {
    const items = normalized.trip.items
      .filter((item) => item.dayId === day.id)
      .sort((left, right) => timeMinutes(left.startTime) - timeMinutes(right.startTime));
    for (let index = 1; index < items.length; index += 1) {
      const fromItem = items[index - 1];
      const toItem = items[index];
      if (!fromItem || !toItem) continue;
      const fromPlace = normalized.trip.places.find((place) => place.id === fromItem.placeId);
      const toPlace = normalized.trip.places.find((place) => place.id === toItem.placeId);
      if (!fromPlace || !toPlace || fromPlace.lat === 0 || toPlace.lat === 0) {
        unknownHops += 1;
        continue;
      }
      const measured = await measurer.measure(task.city, fromPlace, toPlace, mode);
      if (!measured) {
        unknownHops += 1;
        continue;
      }
      peak = Math.max(peak, measured.durationMinutes);
      segments.push({
        id: `baseline-seg-${segments.length + 1}`,
        tripId: normalized.trip.id,
        dayId: day.id,
        fromItemId: fromItem.id,
        toItemId: toItem.id,
        fromPlaceId: fromPlace.id,
        toPlaceId: toPlace.id,
        mode,
        distanceMeters: measured.distanceMeters,
        durationMinutes: measured.durationMinutes,
        meters: measured.distanceMeters,
        minutes: measured.durationMinutes,
        label: mode,
        provider: "amap",
        estimated: false,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  if (unknownHops > 0) assessed = false;
  return {
    segments,
    maxTravelMinutes: segments.length ? Math.round(peak) : null,
    travelAssessed: assessed,
    unknownHops,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

interface PipelineSnapshots {
  trip: Trip;
  revision: number;
  tripId: string;
  warnings: string[];
  ms: number;
}

interface ProposalData {
  proposalId: string | null;
  proposalToken?: string;
  baseRevision: number;
  summary?: string;
  trustChanges?: Array<{ type: string; fromPlaceId?: string; toPlaceId?: string }>;
}

interface ApplyData {
  trip: Trip;
  revision: number;
}

interface EnvelopeLike<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(value: unknown): T {
  const envelope = value as EnvelopeLike<T>;
  if (!envelope.ok || !envelope.data) {
    throw new Error(envelope.error ? `${envelope.error.code}: ${envelope.error.message}` : "command failed without data");
  }
  return envelope.data;
}

async function runPipeline(task: TaskSpec, profile: PlanningProfile, runtime: ReturnType<typeof createRuntime>): Promise<PipelineSnapshots> {
  const start = Date.now();
  const result = await runtime.execute("create-trip", {
    destination: task.city,
    startDate: task.startDate,
    days: task.constraints.days,
    travelers: task.constraints.travelers,
    budget: task.constraints.budget,
    prompt: task.prompt,
    planningProfile: profile,
    fallbackPolicy: "estimated",
    includeExternalOffers: false,
    includeSocialEvidence: false,
  });
  const data = unwrap<{ tripId: string; trip: Trip; revision: number }>(result);
  return {
    tripId: data.tripId,
    trip: data.trip,
    revision: data.revision,
    warnings: ((result as { warnings?: string[] }).warnings ?? []),
    ms: elapsedMs(start),
  };
}

async function repairPipeline(input: {
  runtime: ReturnType<typeof createRuntime>;
  snapshot: PipelineSnapshots;
}): Promise<{ repair: RepairResult; after: Trip | null }> {
  const { runtime, snapshot } = input;
  const before = snapshot.trip.trust?.validation;
  const beforeIssues = before ? before.issues.length : 0;
  const started = Date.now();
  if (!before || beforeIssues === 0) {
    return { repair: { attempted: false, success: null, ms: 0, beforeIssues, afterIssues: beforeIssues, inventedPlaces: [] }, after: null };
  }
  try {
    const proposed = unwrap<ProposalData>(await runtime.execute("propose-trust-replan", {
      tripId: snapshot.tripId,
      expectedTripRevision: snapshot.revision,
      reason: "USER_REQUEST",
    }));
    if (!proposed.proposalId || !proposed.proposalToken) {
      return {
        repair: {
          attempted: true,
          success: null,
          ms: elapsedMs(started),
          beforeIssues,
          afterIssues: beforeIssues,
          inventedPlaces: [],
          note: proposed.summary ?? "没有可自动修复的问题",
        },
        after: null,
      };
    }
    const originalPlaceIds = new Set(snapshot.trip.places.map((place) => place.id));
    const invented = (proposed.trustChanges ?? [])
      .flatMap((change) => [change.fromPlaceId, change.toPlaceId])
      .filter((id): id is string => typeof id === "string" && !originalPlaceIds.has(id));
    const applied = unwrap<ApplyData>(await runtime.execute("apply-change", {
      tripId: snapshot.tripId,
      proposalId: proposed.proposalId,
      proposalToken: proposed.proposalToken,
      expectedTripRevision: snapshot.revision,
      confirmed: true,
    }));
    const afterValidation = applied.trip.trust?.validation;
    const afterIssues = afterValidation ? afterValidation.issues.length : null;
    return {
      repair: {
        attempted: true,
        success: afterIssues !== null && invented.length === 0 && afterIssues < beforeIssues,
        ms: elapsedMs(started),
        beforeIssues,
        afterIssues,
        inventedPlaces: invented,
      },
      after: applied.trip,
    };
  } catch (error) {
    return {
      repair: {
        attempted: true,
        success: false,
        ms: elapsedMs(started),
        beforeIssues,
        afterIssues: null,
        inventedPlaces: [],
        error: error instanceof Error ? error.message : String(error),
      },
      after: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Aggregation and reporting
// ---------------------------------------------------------------------------

interface AggregateSide {
  cases: number;
  factualAccuracy: number;
  addressRate: number;
  duplicateRate: number;
  mealCoverage: number;
  stopsPerDay: number;
  constraintPassRate: number;
  validationPassRate: number;
  avgErrors: number;
  avgWarnings: number;
  avgScore: number;
  avgMaxTravelMinutes: number;
  severeTravelRate: number;
  latencyMeanMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  repairAttempts: number;
  repairSuccesses: number;
  repairSuccessRate: number | null;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index] ?? 0;
}

function aggregateSide(cases: Array<{ metrics: CaseMetrics; ms: number; repair: RepairResult }>): AggregateSide {
  const metrics = cases.map((entry) => entry.metrics);
  const attempts = cases.filter((entry) => entry.repair.attempted && entry.repair.success !== null);
  const successes = attempts.filter((entry) => entry.repair.success === true);
  const latencies = cases.map((entry) => entry.ms);
  const travelled = metrics.filter((metric) => metric.maxTravelMinutes !== null);
  return {
    cases: cases.length,
    factualAccuracy: mean(metrics.map((metric) => metric.factualAccuracy)),
    addressRate: mean(metrics.map((metric) => metric.addressRate)),
    duplicateRate: mean(metrics.map((metric) => metric.duplicateRate)),
    mealCoverage: mean(metrics.map((metric) => metric.mealCoverage)),
    stopsPerDay: mean(metrics.map((metric) => (metric.stopsByDay.length ? mean(metric.stopsByDay) : 0))),
    constraintPassRate: mean(metrics.map((metric) => (metric.constraintsPassed ? 1 : 0))),
    validationPassRate: mean(metrics.map((metric) => (metric.validation.passed ? 1 : 0))),
    avgErrors: mean(metrics.map((metric) => metric.validation.errors)),
    avgWarnings: mean(metrics.map((metric) => metric.validation.warnings)),
    avgScore: mean(metrics.map((metric) => metric.validation.score)),
    avgMaxTravelMinutes: travelled.length ? mean(travelled.map((metric) => metric.maxTravelMinutes as number)) : 0,
    severeTravelRate: travelled.length ? mean(travelled.map((metric) => (metric.severeTravel ? 1 : 0))) : 0,
    latencyMeanMs: Math.round(mean(latencies)),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    repairAttempts: attempts.length,
    repairSuccesses: successes.length,
    repairSuccessRate: attempts.length ? successes.length / attempts.length : null,
  };
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function metricRow(label: string, pipeline: string, baseline: string) {
  return `| ${label} | ${pipeline} | ${baseline} |`;
}

function buildMarkdown(input: {
  generatedAt: string;
  model: string;
  tasks: number;
  pipeline: AggregateSide;
  baseline: AggregateSide | null;
  results: CaseResult[];
}): string {
  const { generatedAt, model, tasks, pipeline, baseline, results } = input;
  const lines: string[] = [
    "# Trust 评测报告（新管线 vs 纯 LLM 基线）",
    "",
    `- 生成时间：${generatedAt}`,
    `- 模型：${model}`,
    `- 数据源：高德地图 Web 服务（实时 POI/路线）+ 真实 LLM 调用`,
    `- 任务数：${tasks}`,
    "",
    "## 总体对比",
    "",
    "| 指标 | Voyage 新管线 | 纯 LLM 基线 |",
    "|---|---|---|",
    metricRow("事实准确率（stop 级）", percent(pipeline.factualAccuracy), baseline ? percent(baseline.factualAccuracy) : "—"),
    metricRow("地址可用率（stop 级）", percent(pipeline.addressRate), baseline ? percent(baseline.addressRate) : "—"),
    metricRow("同日重复地点率", percent(pipeline.duplicateRate), baseline ? percent(baseline.duplicateRate) : "—"),
    metricRow("正餐覆盖率", percent(pipeline.mealCoverage), baseline ? percent(baseline.mealCoverage) : "—"),
    metricRow("每天平均 stop 数", pipeline.stopsPerDay.toFixed(2), baseline ? baseline.stopsPerDay.toFixed(2) : "—"),
    metricRow("约束满足率", percent(pipeline.constraintPassRate), baseline ? percent(baseline.constraintPassRate) : "—"),
    metricRow("校验通过率", percent(pipeline.validationPassRate), baseline ? percent(baseline.validationPassRate) : "—"),
    metricRow("平均 error 数", pipeline.avgErrors.toFixed(2), baseline ? baseline.avgErrors.toFixed(2) : "—"),
    metricRow("平均 warning 数", pipeline.avgWarnings.toFixed(2), baseline ? baseline.avgWarnings.toFixed(2) : "—"),
    metricRow("平均校验分", pipeline.avgScore.toFixed(1), baseline ? baseline.avgScore.toFixed(1) : "—"),
    metricRow("平均最大交通时间", `${pipeline.avgMaxTravelMinutes.toFixed(0)} min`, baseline ? `${baseline.avgMaxTravelMinutes.toFixed(0)} min` : "—"),
    metricRow("严重交通超限率（>2×阈值）", percent(pipeline.severeTravelRate), baseline ? percent(baseline.severeTravelRate) : "—"),
    metricRow("生成时延 p50", `${pipeline.latencyP50Ms} ms`, baseline ? `${baseline.latencyP50Ms} ms` : "—"),
    metricRow("生成时延 p95", `${pipeline.latencyP95Ms} ms`, baseline ? `${baseline.latencyP95Ms} ms` : "—"),
    metricRow(
      "重规划成功率",
      pipeline.repairSuccessRate === null ? "—" : `${percent(pipeline.repairSuccessRate)} (${pipeline.repairSuccesses}/${pipeline.repairAttempts})`,
      baseline ? (baseline.repairSuccessRate === null ? "—" : `${percent(baseline.repairSuccessRate)} (${baseline.repairSuccesses}/${baseline.repairAttempts})`) : "—",
    ),
    "",
    "## 逐任务结果（新管线）",
    "",
    "| 任务 | 城市 | 事实 | 重复率 | 正餐 | stop/天 | error | 最大交通 | 约束 | 重规划 |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];

  for (const result of results) {
    if (!result.pipeline) continue;
    const metrics = result.pipeline.metrics;
    const repair = result.pipeline.repair;
    lines.push(
      `| ${result.id} | ${result.city} | ${percent(metrics.factualAccuracy)} | ${percent(metrics.duplicateRate)} | ${percent(metrics.mealCoverage)} | ${mean(metrics.stopsByDay).toFixed(1)} | ${metrics.validation.errors} | ${metrics.maxTravelMinutes === null ? "—" : `${metrics.maxTravelMinutes} min`} | ${metrics.constraintsPassed ? "PASS" : metrics.constraintFailures.join("; ")} | ${repair.attempted ? (repair.success === null ? "no-op" : repair.success ? "success" : "fail") : "n/a"} |`,
    );
  }

  lines.push("", "## 逐任务结果（纯 LLM 基线）", "", "| 任务 | 城市 | 事实 | 重复率 | 正餐 | stop/天 | error | 最大交通 | 约束 | 重规划 |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const result of results) {
    if (!result.baseline) continue;
    const metrics = result.baseline.metrics;
    const repair = result.baseline.repair;
    lines.push(
      `| ${result.id} | ${result.city} | ${percent(metrics.factualAccuracy)} | ${percent(metrics.duplicateRate)} | ${percent(metrics.mealCoverage)} | ${mean(metrics.stopsByDay).toFixed(1)} | ${metrics.validation.errors} | ${metrics.maxTravelMinutes === null ? "—" : `${metrics.maxTravelMinutes} min`} | ${metrics.constraintsPassed ? "PASS" : metrics.constraintFailures.join("; ")} | ${repair.attempted ? (repair.success === null ? "no-op" : repair.success ? "success" : "fail") : "n/a"} |`,
    );
  }

  const baselineUnverified = results.flatMap((result) => result.baseline?.unverifiedNames.map((name) => `${result.id}: ${name}`) ?? []);
  lines.push("", "## 基线编造/未核实地点", "");
  lines.push(baselineUnverified.length ? baselineUnverified.slice(0, 40).map((entry) => `- ${entry}`).join("\n") : "无。所有基线地点均可在地图数据中核实。");

  const pipelineFailures = results.filter((result) => result.errorPipeline);
  const baselineFailures = results.filter((result) => result.errorBaseline);
  lines.push("", "## 运行失败");
  lines.push(
    pipelineFailures.length || baselineFailures.length
      ? [...pipelineFailures.map((result) => `- ${result.id} pipeline: ${result.errorPipeline}`), ...baselineFailures.map((result) => `- ${result.id} baseline: ${result.errorBaseline}`)].join("\n")
      : "无。",
  );

  lines.push(
    "",
    "## 方法说明与局限",
    "",
    "- 新管线：高德实时 POI 候选 → LLM 只做排序/排程 → 确定性校验 → 自动修复 → 确认后写入。事实准确率取 stop 对应证据卡的 `real` 标记（高德来源）。",
    "- 纯 LLM 基线：单次 LLM 调用直出 JSON 行程，不提供候选池。其事实准确率通过高德按名称检索核实（归一化后精确/包含匹配），未匹配即视为未核实，可能高估或低估。",
    "- 为公平比较，基线的相邻 stop 也用高德路线补齐 `RouteSegment`，再交给同一个 `validateTripTrust`；两边校验器看到的是同一种数据。",
    "- 地址可用率仅衡量是否提供了地址（管线取高德地址，基线取模型自述），不代表地址逐字正确。",
    "- 预算指标：管线使用产品内置的预算估算（默认约为预算的 85% 再分项），基线使用模型自报的 stop 花费之和，两者口径不同，仅作趋势参考。",
    "- 重规划成功率：仅统计有明确结果的尝试。新管线先 `propose-trust-replan`，无自动可修复项时不计入分母；有提案则 `apply-change`，成功 = 问题数下降且未发明地点。基线统计「把校验问题回喂 LLM 再生成」后问题数是否下降且未新增未核实地点。",
    "- 天气为评测当日实时数据，不同日期重跑会有差异；其余输入固定。",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runTrustEvaluation(options: TrustEvaluationOptions = {}) {
  const rootDir = options.rootDir ?? DEFAULT_ROOT;
  const evalDir = path.join(rootDir, "benchmarks", "eval", "trust");
  const resultsDir = path.join(rootDir, "benchmarks", "results");
  const reportPath = path.join(evalDir, "report.json");
  const reportMdPath = path.join(evalDir, "report.md");
  const partialPath = path.join(evalDir, "report.partial.json");
  const summaryPath = path.join(resultsDir, "eval-trust.json");
  const verbose = options.verbose ?? false;
  const skipBaseline = options.skipBaseline ?? false;
  const checkBaselineRoutes = options.checkBaselineRoutes ?? true;
  const persist = options.persist ?? false;
  const log = options.quiet ? () => {} : (...args: unknown[]) => console.log(...args);

  const tasks = options.tasks ?? loadTasks(evalDir, options);
  if (!tasks.length) throw new Error("No tasks selected");

  const provider = await providerFromEnvironment();
  if (provider.kind !== "amap") throw new Error("Trust evaluation requires the real AMap provider (AMAP_SERVER_KEY)");
  const llm = getLlmConfig();
  if (!llm && !skipBaseline) throw new Error("Pure-LLM baseline requires LLM_BASE_URL / LLM_MODEL / LLM_API_KEY");

  const verifier = new PlaceVerifier(provider);
  const measurer = new RouteMeasurer(provider);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-trust-eval-"));
  const runtime = createRuntime(dataDir);
  if (persist) mkdirSync(resultsDir, { recursive: true });

  const results: CaseResult[] = [];
  log(`trust eval: ${tasks.length} tasks, provider=${provider.kind}, model=${llm?.model ?? "n/a"}, dataDir=${dataDir}`);
  const startedAt = Date.now();

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) continue;
    const profile = profileFor(task);
    const result: CaseResult = { id: task.id, city: task.city, prompt: task.prompt };
    const caseStart = Date.now();
    log(`\n[${index + 1}/${tasks.length}] ${task.id} ${task.city} (${task.constraints.days}d, ${task.constraints.travelers}p)`);

    try {
      const snapshot = await runPipeline(task, profile, runtime);
      const validation = snapshot.trip.trust?.validation ?? validateTripTrust(snapshot.trip, []);
      const facts = new Map<string, Fact>();
      for (const item of snapshot.trip.items) {
        const card = snapshot.trip.trust?.evidence.find((candidate) => candidate.placeId === item.placeId);
        facts.set(item.id, { real: card?.real === true, addressPresent: Boolean(card?.address) });
      }
      const maxTravel = snapshot.trip.segments.length
        ? Math.max(...snapshot.trip.segments.map((segment) => segment.durationMinutes ?? segment.minutes))
        : null;
      const metrics = computeMetrics({
        trip: snapshot.trip,
        validation,
        expected: task.expect,
        reportedDays: snapshot.trip.days.length,
        facts,
        maxTravelMinutes: maxTravel,
        travelAssessed: maxTravel !== null,
      });
      const { repair } = await repairPipeline({ runtime, snapshot });
      result.pipeline = {
        ms: snapshot.ms,
        tripId: snapshot.tripId,
        revision: snapshot.revision,
        metrics,
        warnings: snapshot.warnings,
        repair,
      };
      log(
        `  pipeline: ${snapshot.ms}ms stops=${metrics.totalStops} fact=${percent(metrics.factualAccuracy)} dup=${percent(metrics.duplicateRate)} meal=${percent(metrics.mealCoverage)} errors=${metrics.validation.errors} constraints=${metrics.constraintsPassed ? "PASS" : metrics.constraintFailures.join(";")} repair=${repair.attempted ? (repair.success === null ? "no-op" : repair.success ? "success" : "fail") : "n/a"}`,
      );
      if (verbose && snapshot.warnings.length) log(`  warnings: ${snapshot.warnings.slice(0, 6).join(" | ")}`);
    } catch (error) {
      result.errorPipeline = error instanceof Error ? error.message : String(error);
      log(`  pipeline FAILED: ${result.errorPipeline}`);
    }

    if (!skipBaseline) {
      try {
        const baselineStart = Date.now();
        const plan = await generateBaseline([task.prompt, planningProfileToPrompt(profile)].filter(Boolean).join("\n"));
        const generateMs = elapsedMs(baselineStart);
        const normalized = await normalizeBaseline(task, plan, verifier);
        const travel = checkBaselineRoutes
          ? await baselineTravelSegments({ task, profile, normalized, measurer })
          : { segments: [], maxTravelMinutes: null, travelAssessed: false, unknownHops: 0 };
        const baselineTrip: Trip = { ...normalized.trip, segments: travel.segments };
        const baselineValidation = validateTripTrust(baselineTrip, [], { profile });
        const metrics = computeMetrics({
          trip: baselineTrip,
          validation: baselineValidation,
          expected: task.expect,
          reportedDays: normalized.generatedDays,
          facts: normalized.facts,
          maxTravelMinutes: travel.maxTravelMinutes,
          travelAssessed: travel.travelAssessed,
        });
        const repair = await repairBaselineCase({
          task,
          profile,
          plan,
          normalized,
          validation: baselineValidation,
          verifier,
          measurer,
          checkRoutes: checkBaselineRoutes,
        });
        result.baseline = {
          ms: generateMs,
          plan,
          metrics,
          unverifiedNames: normalized.unverifiedNames,
          unknownTravelHops: travel.unknownHops,
          repair,
        };
        log(
          `  baseline: ${generateMs}ms stops=${metrics.totalStops} fact=${percent(metrics.factualAccuracy)} unverified=${normalized.unverifiedNames.length} dup=${percent(metrics.duplicateRate)} meal=${percent(metrics.mealCoverage)} errors=${metrics.validation.errors} constraints=${metrics.constraintsPassed ? "PASS" : metrics.constraintFailures.join(";")} repair=${repair.attempted ? (repair.success === null ? "no-op" : repair.success ? "success" : "fail") : "n/a"}`,
        );
        if (verbose && normalized.unverifiedNames.length) log(`  unverified: ${normalized.unverifiedNames.slice(0, 10).join(" | ")}`);
      } catch (error) {
        result.errorBaseline = error instanceof Error ? error.message : String(error);
        log(`  baseline FAILED: ${result.errorBaseline}`);
      }
    }

    results.push(result);
    if (persist) writeFileSync(partialPath, JSON.stringify({ generatedAt: new Date().toISOString(), cases: results }, null, 2));
    log(`  case total: ${elapsedMs(caseStart)}ms`);
  }

  const pipelineCases = results.filter((result) => result.pipeline).map((result) => ({ metrics: result.pipeline!.metrics, ms: result.pipeline!.ms, repair: result.pipeline!.repair }));
  const baselineCases = results.filter((result) => result.baseline).map((result) => ({ metrics: result.baseline!.metrics, ms: result.baseline!.ms, repair: result.baseline!.repair }));
  const pipelineAggregate = aggregateSide(pipelineCases);
  const baselineAggregate = baselineCases.length ? aggregateSide(baselineCases) : null;
  const generatedAt = new Date().toISOString();
  const model = llm?.model ?? "n/a";

  const report = {
    generatedAt,
    model,
    provider: provider.kind,
    tasks: tasks.length,
    completed: { pipeline: pipelineCases.length, baseline: baselineCases.length },
    pipeline: pipelineAggregate,
    baseline: baselineAggregate,
    cases: results,
    totalRuntimeMs: Date.now() - startedAt,
  };
  if (persist) {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    writeFileSync(reportMdPath, buildMarkdown({ generatedAt, model, tasks: tasks.length, pipeline: pipelineAggregate, baseline: baselineAggregate, results }));
    writeFileSync(summaryPath, JSON.stringify({ generatedAt, model, provider: provider.kind, tasks: tasks.length, pipeline: pipelineAggregate, baseline: baselineAggregate }, null, 2));
    await rm(partialPath, { force: true });
  }
  await rm(dataDir, { recursive: true, force: true });

  log("\n=== aggregate ===");
  log("pipeline:", pipelineAggregate);
  if (baselineAggregate) log("baseline:", baselineAggregate);
  log(`report: ${reportPath}`);
  log(`markdown: ${reportMdPath}`);

  return report;
}

async function repairBaselineCase(input: {
  task: TaskSpec;
  profile: PlanningProfile;
  plan: BaselinePlan;
  normalized: BaselineNormalized;
  validation: ValidationReport;
  verifier: PlaceVerifier;
  measurer: RouteMeasurer;
  checkRoutes: boolean;
}): Promise<RepairResult> {
  const { task, profile, plan, normalized, validation, verifier, measurer, checkRoutes } = input;
  const beforeIssues = validation.issues.length;
  if (beforeIssues === 0) {
    return { attempted: false, success: null, ms: 0, beforeIssues, afterIssues: 0, inventedPlaces: [] };
  }
  const started = Date.now();
  try {
    const repaired = await repairBaseline(plan, validation.issues.map((issue) => `${issue.severity}: ${issue.message}`));
    const repairedNormalized = await normalizeBaseline(task, repaired, verifier);
    const repairedTravel = checkRoutes
      ? await baselineTravelSegments({ task, profile, normalized: repairedNormalized, measurer })
      : { segments: [] };
    const repairedTrip: Trip = { ...repairedNormalized.trip, segments: repairedTravel.segments };
    const repairedValidation = validateTripTrust(repairedTrip, [], { profile });
    const afterIssues = repairedValidation.issues.length;
    const newUnverified = repairedNormalized.unverifiedNames.filter((name) => !normalized.unverifiedNames.includes(name));
    return {
      attempted: true,
      success: afterIssues < beforeIssues && newUnverified.length === 0,
      ms: elapsedMs(started),
      beforeIssues,
      afterIssues,
      inventedPlaces: newUnverified,
    };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      ms: elapsedMs(started),
      beforeIssues,
      afterIssues: null,
      inventedPlaces: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function timeMinutes(startTime: string) {
  const [hour = 0, minute = 0] = startTime.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}
