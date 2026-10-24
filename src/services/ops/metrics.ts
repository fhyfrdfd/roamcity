import type { Place, PlaceCategory, Trip } from "@/types/travel";
import { isOutdoorPlace } from "@/services/trust/heuristics";

export type CrowdLevel = "high" | "medium" | "low";

export interface OpsPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  rating: number;
  reviewCount: number;
  source: "amap" | "trip";
}

export interface CrowdRisk {
  placeId: string;
  name: string;
  dayId?: string;
  dayLabel?: string;
  level: CrowdLevel;
  score: number;
  reviewCount: number;
  reason: string;
  reasons: string[];
  mitigation: string;
}

export interface DayLoad {
  dayId: string;
  label: string;
  stops: number;
  minutes: number;
  walkMinutes: number;
  meters: number;
  /** 0–100, capped at an 8-hour day. */
  loadIndex: number;
}

export interface HourlyLoad {
  dayId: string;
  label: string;
  /** Activity minutes per hour, from startHour to endHour inclusive. */
  bins: number[];
  peakHour: number;
  peakMinutes: number;
}

export interface DensityGrid {
  rows: number;
  cols: number;
  counts: number[];
  max: number;
  /** Approximate cell size in metres, using the trip's latitude. */
  cellMeters: number;
}

export interface OpsRecommendation {
  id: string;
  level: "action" | "watch";
  title: string;
  detail: string;
}

export interface OpsMetrics {
  places: number;
  density: DensityGrid;
  categoryCounts: Array<{ category: PlaceCategory; count: number }>;
  dayLoads: DayLoad[];
  hourly: HourlyLoad[];
  crowdRisks: CrowdRisk[];
  recommendations: OpsRecommendation[];
  sample: { used: boolean; points: number };
  totals: {
    minutes: number;
    walkMinutes: number;
    meters: number;
    highRisk: number;
    mediumRisk: number;
    stops: number;
    estimatedSpend: number;
  };
}

const GRID = 6;
const DAY_CAP_MINUTES = 8 * 60;
export const HOUR_START = 8;
export const HOUR_END = 22;
const EVENING_START = 17;
const EVENING_END = 20;

export function parseClock(value: string) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function placeToPoint(place: Place): OpsPoint {
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    rating: place.rating,
    reviewCount: place.reviewCount,
    source: "trip",
  };
}

/** 1° latitude ≈ 111.32 km; longitude shrinks with cos(lat). */
function metersPerDegree(lat: number) {
  return { lat: 111_320, lng: 111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)) };
}

export function buildDensityGrid(points: OpsPoint[], grid = GRID): DensityGrid {
  if (!points.length) return { rows: grid, cols: grid, counts: Array(grid * grid).fill(0), max: 0, cellMeters: 0 };
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // Pad a bare minimum so all points fall inside the grid instead of on the edge.
  const latSpan = Math.max(maxLat - minLat, 0.002);
  const lngSpan = Math.max(maxLng - minLng, 0.002);
  const counts = Array(grid * grid).fill(0) as number[];
  for (const point of points) {
    const row = Math.min(grid - 1, Math.max(0, Math.floor(((point.lat - minLat) / latSpan) * grid)));
    const col = Math.min(grid - 1, Math.max(0, Math.floor(((point.lng - minLng) / lngSpan) * grid)));
    const index = row * grid + col;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const perDegree = metersPerDegree((minLat + maxLat) / 2);
  const cellMeters = Math.round(Math.min((latSpan / grid) * perDegree.lat, (lngSpan / grid) * perDegree.lng));
  return { rows: grid, cols: grid, counts, max: Math.max(...counts), cellMeters };
}

function itineraryPlaces(trip: Trip): Place[] {
  const ids = new Set(trip.items.map((item) => item.placeId));
  return trip.places.filter((place) => ids.has(place.id) && Number.isFinite(place.lat) && Number.isFinite(place.lng));
}

function dayLoad(trip: Trip, dayId: string): DayLoad {
  const day = trip.days.find((candidate) => candidate.id === dayId);
  if (!day) return { dayId, label: dayId, stops: 0, minutes: 0, walkMinutes: 0, meters: 0, loadIndex: 0 };
  const items = trip.items.filter((item) => item.dayId === day.id);
  const segments = trip.segments.filter((segment) => segment.dayId === day.id);
  const minutes = items.reduce((sum, item) => sum + item.duration, 0) + segments.reduce((sum, segment) => sum + (segment.durationMinutes ?? segment.minutes), 0);
  const walkMinutes = segments.filter((segment) => segment.mode === "walk").reduce((sum, segment) => sum + (segment.durationMinutes ?? segment.minutes), 0);
  const meters = segments.reduce((sum, segment) => sum + (segment.distanceMeters ?? segment.meters), 0);
  return {
    dayId: day.id,
    label: `Day ${day.index + 1}`,
    stops: items.length,
    minutes,
    walkMinutes,
    meters,
    loadIndex: Math.min(100, Math.round((minutes / DAY_CAP_MINUTES) * 100)),
  };
}

/** Splits each stop into per-hour active minutes; transit fills the minutes before arrival. */
function hourlyLoad(trip: Trip, dayId: string): HourlyLoad {
  const day = trip.days.find((candidate) => candidate.id === dayId);
  const bins = Array(HOUR_END - HOUR_START + 1).fill(0) as number[];
  const empty = { dayId, label: day ? `Day ${day.index + 1}` : dayId, bins, peakHour: HOUR_START, peakMinutes: 0 };
  if (!day) return empty;

  const addSpan = (startMinutes: number, durationMinutes: number, weight = 1) => {
    let cursor = Math.max(0, startMinutes);
    const end = startMinutes + Math.max(0, durationMinutes);
    while (cursor < end) {
      const hour = Math.floor(cursor / 60);
      const nextHour = (hour + 1) * 60;
      const sliceEnd = Math.min(end, nextHour);
      const idx = hour - HOUR_START;
      if (idx >= 0 && idx < bins.length) bins[idx] = (bins[idx] ?? 0) + (sliceEnd - cursor) * weight;
      cursor = sliceEnd;
    }
  };

  const items = trip.items.filter((item) => item.dayId === day.id);
  for (const item of items) {
    const start = parseClock(item.startTime);
    const segment = trip.segments.find((candidate) => candidate.dayId === day.id && candidate.toItemId === item.id);
    const travel = segment ? segment.durationMinutes ?? segment.minutes : 0;
    if (travel > 0 && start - travel >= 0) addSpan(start - travel, travel, 0.5);
    addSpan(start, item.duration);
  }

  const peakMinutes = Math.max(...bins);
  return {
    dayId,
    label: `Day ${day.index + 1}`,
    bins,
    peakHour: HOUR_START + Math.max(0, bins.indexOf(peakMinutes)),
    peakMinutes,
  };
}

function weekdayOf(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? -1 : date.getUTCDay();
}

function isRainy(condition: string) {
  return /雨|暴雨|雷/.test(condition);
}

/**
 * Crowd risk is a proxy, never measured footfall: review volume, rating,
 * evening scheduling, weekends and weather stand in for popularity and the UI
 * must label it as an estimate.
 */
export function buildCrowdRisks(trip: Trip): CrowdRisk[] {
  const itemsByPlace = new Map<string, typeof trip.items>();
  for (const item of trip.items) {
    const list = itemsByPlace.get(item.placeId) ?? [];
    list.push(item);
    itemsByPlace.set(item.placeId, list);
  }

  const risks: CrowdRisk[] = [];
  for (const [placeId, items] of itemsByPlace) {
    const place = trip.places.find((candidate) => candidate.id === placeId);
    if (!place) continue;
    const firstItem = items[0];
    const day = firstItem ? trip.days.find((candidate) => candidate.id === firstItem.dayId) : undefined;
    const reasons: string[] = [];
    let score = 0;

    const reviews = place.reviewCount ?? 0;
    if (reviews >= 5000) {
      score += 40;
      reasons.push(`评价 ${reviews.toLocaleString("zh-CN")} 条，热度高`);
    } else if (reviews >= 1500) {
      score += 25;
      reasons.push(`评价 ${reviews.toLocaleString("zh-CN")} 条，热度中等`);
    } else if (reviews >= 500) {
      score += 10;
      reasons.push(`评价 ${reviews.toLocaleString("zh-CN")} 条`);
    }

    if (place.rating >= 4.7) {
      score += 10;
      reasons.push(`评分 ${place.rating.toFixed(1)}，口碑集中`);
    } else if (place.rating >= 4.5) {
      score += 5;
    }

    const eveningItem = items.find((item) => {
      const start = parseClock(item.startTime);
      return start >= EVENING_START * 60 && start < EVENING_END * 60;
    });
    if (eveningItem) {
      score += 15;
      reasons.push("安排在晚间热门时段");
    }

    if (day) {
      const weekday = weekdayOf(day.date);
      if (weekday === 0 || weekday === 6) {
        score += 10;
        reasons.push("当天是周末");
      }
      if (isRainy(day.weather.condition)) {
        score += 5;
        reasons.push("雨雪天气，室内替代点会更挤");
      }
      if (isOutdoorPlace(place)) {
        score += 5;
      }
    }

    score = Math.min(100, score);
    const level: CrowdLevel = score >= 60 ? "high" : score >= 35 ? "medium" : "low";
    const mitigation =
      level === "high"
        ? "建议错峰（避开 17:00–20:00）或替换为低峰地点"
        : level === "medium"
          ? "预留 20–30 分钟排队缓冲"
          : "暂无特别建议";
    risks.push({
      placeId,
      name: place.name,
      ...(day ? { dayId: day.id, dayLabel: `Day ${day.index + 1}` } : {}),
      level,
      score,
      reviewCount: reviews,
      reason: reasons[0] ?? "无明显拥堵信号",
      reasons,
      mitigation,
    });
  }

  return risks.sort((left, right) => right.score - left.score || right.reviewCount - left.reviewCount);
}

function buildRecommendations(metrics: Omit<OpsMetrics, "recommendations">): OpsRecommendation[] {
  const recommendations: OpsRecommendation[] = [];

  for (const risk of metrics.crowdRisks.filter((candidate) => candidate.level === "high").slice(0, 3)) {
    recommendations.push({
      id: `risk-${risk.placeId}`,
      level: "action",
      title: `${risk.name} 处于高风险时段`,
      detail: `${risk.reasons.join("；")}。${risk.mitigation}。`,
    });
  }

  for (const load of metrics.dayLoads.filter((candidate) => candidate.loadIndex >= 85)) {
    recommendations.push({
      id: `load-${load.dayId}`,
      level: "action",
      title: `${load.label} 安排过密（${load.loadIndex}%）`,
      detail: `当天 ${load.stops} 个 stop、约 ${Math.round(load.minutes / 60 * 10) / 10} 小时，建议拆分到相邻天或减少一个付费景点。`,
    });
  }

  const walkHeavy = metrics.dayLoads.filter((load) => load.walkMinutes >= 90);
  if (walkHeavy.length) {
    recommendations.push({
      id: "walk-heavy",
      level: "watch",
      title: "步行强度偏高",
      detail: `${walkHeavy.map((load) => `${load.label} 步行 ${Math.round(load.walkMinutes)} 分钟`).join("；")}。带老人或儿童时建议改用公交或打车。`,
    });
  }

  const topCell = metrics.density.max;
  const concentrated = metrics.places > 4 && topCell / metrics.places >= 0.4;
  if (concentrated) {
    recommendations.push({
      id: "density",
      level: "watch",
      title: "POI 过度集中",
      detail: `已有 ${topCell}/${metrics.places} 个 POI 落在同一网格，核心区在高峰时段更容易拥堵，建议分时段进入。`,
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      id: "healthy",
      level: "watch",
      title: "当前指标平稳",
      detail: "没有高风险时段或过密安排；仍建议在出发前复核实时客流与营业状态。",
    });
  }
  return recommendations;
}

export function computeOpsMetrics(trip: Trip, samplePoints: OpsPoint[] = []): OpsMetrics {
  const tripPlaces = itineraryPlaces(trip);
  const points = samplePoints.length ? samplePoints : tripPlaces.map(placeToPoint);
  const density = buildDensityGrid(points);
  const dayLoads = trip.days.map((day) => dayLoad(trip, day.id));
  const hourly = trip.days.map((day) => hourlyLoad(trip, day.id));
  const crowdRisks = buildCrowdRisks(trip);

  const categoryTally = new Map<PlaceCategory, number>();
  for (const point of points) categoryTally.set(point.category, (categoryTally.get(point.category) ?? 0) + 1);
  const categoryCounts = [...categoryTally.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count);

  const totals = {
    minutes: dayLoads.reduce((sum, load) => sum + load.minutes, 0),
    walkMinutes: dayLoads.reduce((sum, load) => sum + load.walkMinutes, 0),
    meters: dayLoads.reduce((sum, load) => sum + load.meters, 0),
    highRisk: crowdRisks.filter((risk) => risk.level === "high").length,
    mediumRisk: crowdRisks.filter((risk) => risk.level === "medium").length,
    stops: trip.items.length,
    estimatedSpend: trip.estimatedSpend,
  };

  const base = {
    places: points.length,
    density,
    categoryCounts,
    dayLoads,
    hourly,
    crowdRisks,
    sample: { used: samplePoints.length > 0, points: samplePoints.length },
    totals,
  };
  return { ...base, recommendations: buildRecommendations(base) };
}
