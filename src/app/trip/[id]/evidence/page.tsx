"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ShieldCheck, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import { buildEvidenceCards } from "@/services/trust/evidence";
import type { EvidenceCard } from "@/schemas/trust";
import type { Trip } from "@/types/travel";

const SOURCE_LABEL: Record<EvidenceCard["source"], string> = {
  amap: "高德实时数据",
  official: "官方来源",
  demo: "Demo / 估算",
  manual: "人工或未验证",
};

function groupByDay(trip: Trip, cards: EvidenceCard[]) {
  const dayByPlace = new Map<string, { dayId: string; index: number }>();
  for (const item of trip.items) {
    const day = trip.days.find((candidate) => candidate.id === item.dayId);
    if (day && !dayByPlace.has(item.placeId)) dayByPlace.set(item.placeId, { dayId: day.id, index: day.index });
  }
  const groups = new Map<string, { label: string; order: number; cards: EvidenceCard[] }>();
  for (const card of cards) {
    const day = dayByPlace.get(card.placeId);
    const key = day ? day.dayId : "unplanned";
    if (!groups.has(key)) {
      groups.set(key, {
        label: day ? `Day ${day.index + 1}` : "未排入行程",
        order: day ? day.index : Number.MAX_SAFE_INTEGER,
        cards: [],
      });
    }
    groups.get(key)!.cards.push(card);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

function EvidenceCardView({ card }: { card: EvidenceCard }) {
  return (
    <article className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold">{card.name}</h3>
            {card.real ? (
              <Badge variant="teal" className="text-[10px] text-primary">真实来源</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-amber-700">估算 / 未验证</Badge>
            )}
            <Badge variant="outline" className="text-[10px]">{SOURCE_LABEL[card.source]}</Badge>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{card.whyChosen}</p>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {card.real ? <ShieldCheck className="size-3.5 text-emerald-600" /> : <TriangleAlert className="size-3.5 text-amber-600" />}
          <span>置信度 {Math.round(card.confidence * 100)}%</span>
        </div>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] leading-4 text-muted-foreground sm:grid-cols-2">
        {card.sourceId ? <div><dt className="inline font-medium text-foreground">来源 ID：</dt><dd className="inline">{card.sourceId}</dd></div> : null}
        <div><dt className="inline font-medium text-foreground">数据记录时间：</dt><dd className="inline">{new Date(card.fetchedAt).toLocaleString("zh-CN")}</dd></div>
        {card.address ? <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">地址：</dt><dd className="inline">{card.address}</dd></div> : null}
        {card.openingHours ? <div><dt className="inline font-medium text-foreground">营业时间：</dt><dd className="inline">{card.openingHours}</dd></div> : null}
        {card.price !== undefined ? <div><dt className="inline font-medium text-foreground">参考价格：</dt><dd className="inline">¥{card.price}</dd></div> : null}
        {card.rating !== undefined ? <div><dt className="inline font-medium text-foreground">评分：</dt><dd className="inline">{card.rating.toFixed(1)}</dd></div> : null}
        {card.distanceFromPreviousM !== undefined ? (
          <div>
            <dt className="inline font-medium text-foreground">距上一站：</dt>
            <dd className="inline">{Math.round(card.distanceFromPreviousM)} 米 · 约 {Math.round(card.travelMinutesFromPrevious ?? 0)} 分钟</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const trip = useTripStore((state) => state.trip);
  const cards = useMemo(
    () => (trip.trust?.evidence.length ? trip.trust.evidence : buildEvidenceCards(trip)),
    [trip],
  );
  const groups = useMemo(() => groupByDay(trip, cards), [trip, cards]);
  const realCount = cards.filter((card) => card.real).length;

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-mono text-[10px] text-primary">EVIDENCE / PROOF CHAIN</p>
          <h1 className="mt-1.5 text-xl font-semibold">证据来源</h1>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            每个地点为何被选中、来自哪里、何时抓取。真实来源与估算结果分开标注，估算不会被写成事实。
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={`/trip/${encodeURIComponent(id)}`}>
            <ArrowLeft className="mr-1 size-3.5" />
            返回行程
          </Link>
        </Button>
      </div>

      <section className="mt-4 grid grid-cols-3 gap-2" aria-label="证据统计">
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>证据卡</strong>
          <p className="mt-1 text-muted-foreground">{cards.length} 条</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>真实来源</strong>
          <p className="mt-1 text-emerald-700">{realCount} 条</p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs">
          <strong>估算 / 未验证</strong>
          <p className="mt-1 text-amber-700">{cards.length - realCount} 条</p>
        </div>
      </section>

      {cards.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          这次行程还没有可展示的 POI 证据。把地点加入行程后，这里会列出每个地点的来源与抓取时间。
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="mb-2 text-sm font-semibold">{group.label}</h2>
              <div className="space-y-2.5">
                {group.cards.map((card) => <EvidenceCardView key={`${group.label}-${card.placeId}`} card={card} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
