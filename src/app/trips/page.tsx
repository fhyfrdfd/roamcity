"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppFrame } from "@/components/layout/AppFrame";
import { TravelImage } from "@/components/travel/TravelImage";
import { Button } from "@/components/ui/button";
import { tripRepository } from "@/services/trips/repository";
import { formatMonthDay, tripDurationLabel, uid } from "@/lib/utils";
import type { Trip, TripStatus, TripSummary } from "@/types/travel";
import { Plus, MoreHorizontal, Copy, Archive, Trash2, Calendar, Users, Wallet, Compass } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { deleteJson, getJson } from "@/lib/api-client";

type TripCategory = "all" | "upcoming" | "active" | "past";

const STATUS_LABELS: Record<TripStatus, { label: string; color: string }> = {
  draft: { label: "规划中", color: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  ready: { label: "已就绪", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20" },
  traveling: { label: "旅途中", color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
  done: { label: "已完成", color: "bg-secondary text-muted-foreground border-border" },
};

export default function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [category, setCategory] = useState<TripCategory>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getJson<{ trips?: TripSummary[] }>("/api/voyage/trips")
      .then((result) => setTrips(result.trips ?? []))
      .catch(() => setTrips([]))
      .finally(() => setLoading(false));
  }, []);

  const handleDuplicate = async (summary: TripSummary) => {
    try {
      const full = await tripRepository.get(summary.id);
      if (!full) return;
      const dup: Trip = {
        ...structuredClone(full),
        id: uid("trip"),
        title: `${full.title} (副本)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await tripRepository.save(dup);
      const updatedList = await tripRepository.list();
      setTrips(updatedList);
      toast.success("行程已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleDelete = async (tripId: string) => {
    if (trips.length <= 1) {
      toast.error("保留至少一个行程项目");
      return;
    }
    try {
      await deleteJson("/api/voyage/trips", { tripId });
      setTrips((prev) => prev.filter((t) => t.id !== tripId));
      toast.success("行程已移除");
    } catch {
      toast.error("删除失败，行程仍保留");
    }
  };

  const handleArchive = async (summary: TripSummary) => {
    try {
      const full = await tripRepository.get(summary.id);
      if (!full) return;
      const updated: Trip = { ...full, status: "done" };
      await tripRepository.save(updated);
      const updatedList = await tripRepository.list();
      setTrips(updatedList);
      toast.info("已归档至历史旅行");
    } catch {
      toast.error("归档失败");
    }
  };

  const filteredTrips = trips.filter((t) => {
    if (category === "all") return true;
    if (category === "upcoming") return t.status === "draft" || t.status === "ready";
    if (category === "active") return t.status === "traveling";
    if (category === "past") return t.status === "done";
    return true;
  });
  const counts = {
    all: trips.length,
    upcoming: trips.filter((t) => t.status === "draft" || t.status === "ready").length,
    active: trips.filter((t) => t.status === "traveling").length,
    past: trips.filter((t) => t.status === "done").length,
  };

  return (
    <AppFrame>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label-mono text-[10px] text-primary">TRIPS / WORKSPACE</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">我的旅行</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管理正在规划、进行中与已完成的旅行操作系统项目
            </p>
          </div>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/new-trip">
              <Plus className="size-4" />
              创建新行程
            </Link>
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="行程统计">
          {[
            ["全部", counts.all],
            ["即将出发", counts.upcoming],
            ["旅途中", counts.active],
            ["历史", counts.past],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[10px] border border-border bg-surface/70 px-3 py-2">
              <p className="label-mono text-[9px] text-muted-foreground">{label}</p>
              <p className="label-mono mt-1 text-lg text-foreground">{value}</p>
            </div>
          ))}
        </div>

        {/* Tab Filters */}
        <div className="mt-5 flex gap-2 border-b border-border pb-3">
          {[
            { id: "all", label: "全部行程" },
            { id: "upcoming", label: "即将出发" },
            { id: "active", label: "旅途中" },
            { id: "past", label: "历史旅行" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategory(tab.id as TripCategory)}
              className={`rounded-full border px-3.5 py-1 text-xs font-medium transition-colors ${
                category === tab.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className="label-mono ml-1.5 text-[9px] opacity-70">{counts[tab.id as TripCategory]}</span>
            </button>
          ))}
        </div>

        {/* Trip Cards Grid */}
        {loading ? (
          <div className="mt-8 text-center text-sm text-muted-foreground">正在加载行程...</div>
        ) : filteredTrips.length === 0 ? (
          <div className="mt-12 rounded-[14px] border border-dashed border-border p-12 text-center space-y-3">
            <Compass className="size-8 mx-auto text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">当前分类下暂无行程</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/new-trip">立即规划一次旅行</Link>
            </Button>
            {process.env.NEXT_PUBLIC_VOYAGE_DEMO_MODE === "true" ? (
              // Mirrors the server-side VOYAGE_DEMO_MODE gate on the demo fixture.
              <Link href="/trip/chongqing-2026" className="text-[12px] text-muted-foreground transition-colors hover:text-primary">
                先看看示例行程
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {filteredTrips.map((tripItem) => {
              const status = STATUS_LABELS[tripItem.status ?? "ready"];
              return (
                <article
                  key={tripItem.id}
                  className="group relative flex flex-col overflow-hidden rounded-[12px] border border-border bg-surface/80 shadow-[var(--shadow-float)] backdrop-blur-sm transition-colors hover:border-primary/30"
                >
                  <Link href={`/trip/${tripItem.id}`} className="block relative h-48 w-full overflow-hidden">
                    <TravelImage
                      src={tripItem.coverImage}
                      alt={tripItem.title}
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-3 left-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border shadow-xs ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                  </Link>

                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/trip/${tripItem.id}`}>
                          <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                            {tripItem.title}
                          </h2>
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="rounded-[6px] p-1 text-muted-foreground hover:bg-secondary"
                              aria-label="操作"
                            >
                              <MoreHorizontal className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="text-[13px]">
                            <DropdownMenuItem asChild>
                              <Link href={`/trip/${tripItem.id}`}>打开行程</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/trip/${tripItem.id}/today`}>进入 Today 现场</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void handleDuplicate(tripItem)}>
                              <Copy className="size-3.5 mr-1.5" />
                              复制行程
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void handleArchive(tripItem)}>
                              <Archive className="size-3.5 mr-1.5" />
                              归档
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-rose-600 focus:text-rose-600"
                              onSelect={() => void handleDelete(tripItem.id)}
                            >
                              <Trash2 className="size-3.5 mr-1.5" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div className="mt-2.5 grid grid-cols-2 gap-y-1.5 text-[12px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="size-3 text-primary" />
                          <span className="font-mono tabular-nums">{formatMonthDay(tripItem.startDate)} – {formatMonthDay(tripItem.endDate)}</span>
                          <span className="text-[10px]">({tripDurationLabel(tripItem.startDate, tripItem.endDate)})</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Users className="size-3 text-primary" />
                          {tripItem.travelers} 人出行
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Wallet className="size-3 text-primary" />
                          <span className="font-mono tabular-nums">预算 ¥{tripItem.budget.toLocaleString()}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Compass className="size-3 text-primary" />
                          {tripItem.destination}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border/70 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {tripItem.destination} · 城市探索
                      </span>
                      <Button asChild variant="ghost" size="sm" className="h-8 text-xs font-medium">
                        <Link href={`/trip/${tripItem.id}`}>进入工作台 →</Link>
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppFrame>
  );
}
