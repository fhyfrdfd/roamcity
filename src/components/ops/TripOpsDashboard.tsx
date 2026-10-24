"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import { getJson } from "@/lib/api-client";
import {
  computeOpsMetrics,
  HOUR_END,
  HOUR_START,
  type CrowdLevel,
  type OpsPoint,
} from "@/services/ops/metrics";
import { PLACE_CATEGORY_LABEL, type PlaceCategory } from "@/types/travel";

const LEVEL_LABEL: Record<CrowdLevel, string> = { high: "高", medium: "中", low: "低" };
const LEVEL_CLASS: Record<CrowdLevel, string> = {
  high: "text-red-700 border-red-300 bg-red-50 dark:text-red-200 dark:border-red-500/30 dark:bg-red-950/40",
  medium: "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-200 dark:border-amber-500/30 dark:bg-amber-950/40",
  low: "text-muted-foreground",
};
const CATEGORY_DOT: Partial<Record<PlaceCategory, string>> = {
  attraction: "bg-sky-500",
  food: "bg-orange-500",
  hotel: "bg-violet-500",
  shopping: "bg-pink-500",
  cafe: "bg-amber-600",
  activity: "bg-rose-500",
  viewpoint: "bg-cyan-500",
  transport: "bg-slate-500",
};

const SAMPLE_KEYWORDS = ["景点", "美食", "酒店", "购物", "咖啡"];
const SAMPLE_TTL_MS = 10 * 60 * 1000;
/** Sample per city for 10 minutes: the AMap quota is shared and this view is repeatedly opened. */
const sampleCache = new Map<string, { at: number; points: OpsPoint[] }>();

interface RemotePoi {
  sourceId: string;
  name: string;
  lng: number;
  lat: number;
  type: string;
  rating?: number;
  reviewCount?: number;
}

function sampleCategory(type: string, name: string): PlaceCategory {
  if (/餐饮|美食|小吃|火锅|面/.test(type) || /火锅|小面|餐厅|小吃/.test(name)) return "food";
  if (/酒店|宾馆|民宿|旅馆/.test(type)) return "hotel";
  if (/购物|商场|百货|超市/.test(type)) return "shopping";
  if (/咖啡|茶座|奶茶|甜品/.test(type)) return "cafe";
  if (/演出|剧场|娱乐|体育|体验/.test(type)) return "activity";
  if (/博物馆|展览|美术馆|陈列馆|公园|绿地/.test(type) || /博物馆|美术馆|公园/.test(name)) return "attraction";
  if (/观景|景点|名胜/.test(type)) return "attraction";
  return "attraction";
}

function pointFromPoi(poi: RemotePoi): OpsPoint {
  return {
    id: poi.sourceId ? `amap-${poi.sourceId}` : `amap-${poi.name}-${poi.lat}-${poi.lng}`,
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    category: sampleCategory(poi.type, poi.name),
    rating: poi.rating ?? 0,
    reviewCount: poi.reviewCount ?? 0,
    source: "amap",
  };
}

function formatKm(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function TripOpsDashboard() {
  const trip = useTripStore((state) => state.trip);
  const [selectedDay, setSelectedDay] = useState<"all" | string>("all");
  const [riskFilter, setRiskFilter] = useState<"all" | CrowdLevel>("all");
  const [sample, setSample] = useState<OpsPoint[]>([]);
  const [sampleState, setSampleState] = useState<"loading" | "amap" | "fallback">("loading");

  useEffect(() => {
    if (!trip.destination) {
      setSampleState("fallback");
      return;
    }
    const cached = sampleCache.get(trip.destination);
    if (cached && Date.now() - cached.at < SAMPLE_TTL_MS) {
      setSample(cached.points);
      setSampleState("amap");
      return;
    }
    let active = true;
    const controller = new AbortController();
    setSampleState("loading");
    void Promise.all(
      SAMPLE_KEYWORDS.map((keyword) =>
        getJson<{ source?: "amap" | "mock"; pois?: RemotePoi[] }>(
          `/api/amap/poi?city=${encodeURIComponent(trip.destination)}&keywords=${encodeURIComponent(keyword)}`,
          { signal: controller.signal },
        ).catch(() => ({ pois: [] as RemotePoi[] })),
      ),
    )
      .then((results) => {
        if (!active) return;
        const seen = new Set<string>();
        const points: OpsPoint[] = [];
        for (const result of results) {
          for (const poi of result.pois ?? []) {
            const point = pointFromPoi(poi);
            if (seen.has(point.id)) continue;
            seen.add(point.id);
            points.push(point);
          }
        }
        setSample(points);
        setSampleState(points.length ? "amap" : "fallback");
        if (points.length) sampleCache.set(trip.destination, { at: Date.now(), points });
      })
      .catch(() => {
        if (active) setSampleState("fallback");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [trip.destination]);

  const metrics = useMemo(() => computeOpsMetrics(trip, sample), [trip, sample]);
  const { density, dayLoads, hourly, crowdRisks, recommendations, totals } = metrics;

  const visibleHourly = useMemo(() => {
    if (selectedDay !== "all") {
      return hourly.filter((entry) => entry.dayId === selectedDay);
    }
    const bins = Array(HOUR_END - HOUR_START + 1).fill(0) as number[];
    for (const entry of hourly) {
      entry.bins.forEach((value, index) => {
        bins[index] = (bins[index] ?? 0) + value;
      });
    }
    return [{ dayId: "all", label: "全部", bins, peakHour: HOUR_START + Math.max(0, bins.indexOf(Math.max(...bins))), peakMinutes: Math.max(...bins) }];
  }, [hourly, selectedDay]);

  const visibleRisks = crowdRisks.filter(
    (risk) =>
      (selectedDay === "all" || risk.dayId === selectedDay) &&
      (riskFilter === "all" || risk.level === riskFilter),
  );

  const exportJson = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      tripId: trip.id,
      destination: trip.destination,
      sample: metrics.sample,
      totals,
      density,
      categoryCounts: metrics.categoryCounts,
      dayLoads,
      hourly,
      crowdRisks,
      recommendations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ops-${trip.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const maxHourly = Math.max(60, ...visibleHourly.flatMap((entry) => entry.bins));

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-mono text-[10px] text-primary">OPS / {trip.destination}</p>
          <h1 className="mt-1.5 text-xl font-semibold">运营看点 · {trip.destination}</h1>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            面向景区/文旅局的行程运营看板。指标由当前行程与城市 POI 样本计算；客流风险为估算，不替代实时客流数据。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {sampleState === "loading"
              ? "正在获取城市样本…"
              : metrics.sample.used
                ? `城市 POI 样本 ${metrics.sample.points} 个`
                : "仅行程内 POI"}
          </Badge>
          <Button size="sm" variant="outline" onClick={exportJson} data-testid="ops-export">
            <Download className="mr-1 size-3.5" />
            导出 JSON
          </Button>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="运营指标">
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>POI 数</strong>
          <p className="mt-1 text-muted-foreground">{metrics.places} 个</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>行程 stop</strong>
          <p className="mt-1 text-muted-foreground">{totals.stops} 个</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>路线总耗时</strong>
          <p className="mt-1 text-muted-foreground">{Math.round(totals.minutes / 60 * 10) / 10} 小时</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>步行</strong>
          <p className="mt-1 text-muted-foreground">{Math.round(totals.walkMinutes)} 分钟 · {formatKm(totals.meters)}</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>高/中风险 POI</strong>
          <p className="mt-1 text-muted-foreground">{totals.highRisk} / {totals.mediumRisk} 个</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>估算花费</strong>
          <p className="mt-1 text-muted-foreground">¥{Math.round(totals.estimatedSpend).toLocaleString("zh-CN")}</p>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="按天筛选">
        <button
          type="button"
          onClick={() => setSelectedDay("all")}
          aria-pressed={selectedDay === "all"}
          className={`rounded-full border px-2.5 py-1 text-[11px] ${selectedDay === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
        >
          全部
        </button>
        {trip.days.map((day) => (
          <button
            key={day.id}
            type="button"
            onClick={() => setSelectedDay(day.id)}
            aria-pressed={selectedDay === day.id}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${selectedDay === day.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
          >
            Day {day.index + 1}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-[16px] border border-border bg-surface p-4" aria-label="POI 密度">
          <div className="flex items-end justify-between gap-2">
            <h2 className="text-sm font-semibold">POI 密度</h2>
            <span className="text-[11px] text-muted-foreground">
              6 × 6 网格 · 每格约 {density.cellMeters ? `${density.cellMeters} m` : "—"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-5">
            <svg
              role="img"
              aria-label="POI 密度网格"
              width={180}
              height={180}
              viewBox="0 0 180 180"
              className="rounded-lg border border-border bg-background"
            >
              {Array.from({ length: density.rows * density.cols }).map((_, index) => {
                const row = Math.floor(index / density.cols);
                const col = index % density.cols;
                const count = density.counts[index] ?? 0;
                const ratio = density.max ? count / density.max : 0;
                return (
                  <rect
                    key={index}
                    x={col * 30}
                    y={row * 30}
                    width={29}
                    height={29}
                    rx={4}
                    fill="var(--primary)"
                    fillOpacity={count ? 0.15 + ratio * 0.75 : 0}
                    className={count ? "" : "fill-muted"}
                    aria-label={`第 ${row + 1} 行第 ${col + 1} 列 ${count} 个 POI`}
                  />
                );
              })}
            </svg>
            <div className="min-w-0 flex-1 text-[11px] leading-5 text-muted-foreground">
              <p>颜色越深，POI 越集中；最高一格 {density.max} 个。</p>
              <div className="mt-2 space-y-1">
                {metrics.categoryCounts.slice(0, 6).map((entry) => (
                  <p key={entry.category} className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${CATEGORY_DOT[entry.category] ?? "bg-muted-foreground"}`} />
                    {PLACE_CATEGORY_LABEL[entry.category]} · {entry.count}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[16px] border border-border bg-surface p-4" aria-label="分时负载">
          <div className="flex items-end justify-between gap-2">
            <h2 className="text-sm font-semibold">分时负载</h2>
            <span className="text-[11px] text-muted-foreground">
              {selectedDay === "all" ? "全部天数合计" : visibleHourly[0]?.label} · 活动分钟/小时
            </span>
          </div>
          <svg role="img" aria-label="分时负载图" viewBox="0 0 320 120" className="mt-3 w-full">
            {visibleHourly[0]?.bins.map((value, index) => {
              const width = 320 / (HOUR_END - HOUR_START + 1);
              const height = Math.round((value / maxHourly) * 90);
              const hot = index + HOUR_START >= 17 && index + HOUR_START < 20;
              return (
                <g key={index}>
                  <rect
                    x={index * width + 2}
                    y={100 - height}
                    width={width - 4}
                    height={Math.max(height, 1)}
                    rx={2}
                    className={hot ? "fill-amber-500" : "fill-primary"}
                    fillOpacity={0.85}
                  />
                  {index % 3 === 0 ? (
                    <text x={index * width + width / 2} y={114} textAnchor="middle" className="fill-muted-foreground text-[8px]">
                      {index + HOUR_START}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <p className="mt-1 text-[10px] text-muted-foreground">
            17–20 点标为黄色热门时段；交通分钟按 0.5 权重折算。
            {visibleHourly[0] ? ` 峰值 ${visibleHourly[0].peakHour}:00（${Math.round(visibleHourly[0].peakMinutes)} 分钟）。` : ""}
          </p>
        </section>
      </div>

      <section className="mt-4 rounded-[16px] border border-border bg-surface p-4" aria-label="路线负载">
        <h2 className="text-sm font-semibold">路线负载（按天）</h2>
        <div className="mt-3 space-y-3">
          {dayLoads.map((load) => (
            <div key={load.dayId}>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{load.label}</span>
                <span>{load.stops} 个 stop · {Math.round(load.minutes / 60 * 10) / 10} 小时 · 步行 {Math.round(load.walkMinutes)} 分钟</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${load.label} 负载指数 ${load.loadIndex}`}>
                <div
                  className={`h-full rounded-full ${load.loadIndex >= 85 ? "bg-red-500" : load.loadIndex >= 60 ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${Math.max(load.loadIndex, 4)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">负载指数以 8 小时为 100%，含停留与交通时间，不含往返住地。</p>
      </section>

      <section className="mt-4 rounded-[16px] border border-border bg-surface p-4" aria-label="客流风险">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold">客流风险（估算）</h2>
          <div className="flex items-center gap-1" role="group" aria-label="风险等级筛选">
            {(["all", "high", "medium", "low"] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setRiskFilter(level)}
                aria-pressed={riskFilter === level}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${riskFilter === level ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"}`}
              >
                {level === "all" ? "全部" : `${LEVEL_LABEL[level]}风险`}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {visibleRisks.length ? visibleRisks.map((risk) => (
            <article key={risk.placeId} className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                  {risk.name}
                  {risk.dayLabel ? <span className="text-[10px] font-normal text-muted-foreground">{risk.dayLabel}</span> : null}
                  <span className="text-[10px] font-normal text-muted-foreground">风险分 {risk.score}</span>
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{risk.reasons.join("；") || risk.reason}</p>
                <p className="mt-0.5 text-[10px] leading-4 text-foreground/80">处置：{risk.mitigation}</p>
              </div>
              <Badge variant="outline" className={`shrink-0 text-[10px] ${LEVEL_CLASS[risk.level]}`}>
                {LEVEL_LABEL[risk.level]}风险
              </Badge>
            </article>
          )) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
              当前筛选下没有 POI。
            </p>
          )}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          估算方法：评价量（≥5000 高、≥1500 中）+ 评分 + 晚间时段 + 周末 + 天气。只能提示“可能排队”，不能替代景区实时客流数据。
        </p>
      </section>

      <section className="mt-4 rounded-[16px] border border-border bg-surface p-4" aria-label="运营建议">
        <h2 className="text-sm font-semibold">运营建议</h2>
        <div className="mt-2 space-y-2">
          {recommendations.map((item) => (
            <article key={item.id} className="rounded-lg border border-border/70 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[12px] font-medium">
                <Badge variant="outline" className={`text-[9px] ${item.level === "action" ? "border-red-300 text-red-700" : "border-amber-300 text-amber-700"}`}>
                  {item.level === "action" ? "行动" : "关注"}
                </Badge>
                {item.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{item.detail}</p>
            </article>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          POI 密度样本来自高德城市检索（每类最多 16 个），是抽样而非全量；导出 JSON 可用于交接或二次分析。
        </p>
      </section>
    </div>
  );
}
