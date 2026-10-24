"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Eye } from "lucide-react";
import { MapCanvas } from "@/components/map/MapCanvas";
import type { Trip } from "@/types/travel";
import { hydrateTrip } from "@/store/trip-store";
import { getJson } from "@/lib/api-client";
import { shareErrorMessage } from "@/features/share/share-error";

export default function SharePage({ params }: { params: { token: string } }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState("");
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    void getJson<{ trip?: Trip }>(`/api/voyage/share?token=${encodeURIComponent(params.token)}`)
      .then((data) => {
        if (!data.trip) { setError(shareErrorMessage(undefined)); return; }
        hydrateTrip(data.trip);
        setTrip(data.trip);
      })
      .catch((error: unknown) => setError(shareErrorMessage(error)));
  }, [params.token]);

  if (error) {
    return <main className="grid min-h-dvh place-items-center p-6 text-sm text-muted-foreground">{error}</main>;
  }
  if (!trip) {
    return <main className="grid min-h-dvh place-items-center p-6 text-sm text-muted-foreground">正在加载共享行程…</main>;
  }

  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b border-border bg-surface/80 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-mono text-[10px] text-primary">SHARED ITINERARY · READ ONLY</p>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{trip.title}</h1>
            <p className="mt-1 font-mono text-[12px] tabular-nums text-muted-foreground">
              {trip.destination} · {trip.startDate} → {trip.endDate} · {trip.travelers} 人
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted-foreground">
            <Eye className="size-3" /> 只读分享 · 不会修改原行程
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-[380px_1fr] md:p-5">
        <section
          aria-label="共享行程明细"
          className="order-2 max-h-[60vh] overflow-y-auto rounded-[12px] border border-border bg-surface/80 p-4 backdrop-blur-sm scrollbar-thin md:order-1 md:max-h-[calc(100dvh-120px)]"
        >
          {trip.days.map((day) => (
            <article key={day.id} className="border-b border-border/70 py-4 first:pt-0 last:border-b-0">
              <p className="label-mono text-[10px] text-primary">
                DAY {day.index + 1} · <span className="tabular-nums">{day.date}</span>
              </p>
              <h2 className="mt-1 text-sm font-medium">{day.title}</h2>
              <div className="mt-2.5 space-y-1.5">
                {trip.items
                  .filter((item) => item.dayId === day.id)
                  .sort((a, b) => a.order - b.order)
                  .map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5 text-[13px]">
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{item.startTime}</span>
                      <span className="min-w-0 flex-1 truncate">{trip.places.find((place) => place.id === item.placeId)?.name}</span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{item.duration}m</span>
                    </div>
                  ))}
              </div>
            </article>
          ))}
        </section>

        <section className="order-1 min-h-[42vh] overflow-hidden rounded-[12px] border border-border md:order-2 md:min-h-[calc(100dvh-120px)]" aria-label="共享行程地图">
          <MapCanvas mode="PLAN" theme={resolvedTheme === "light" ? "light" : "dark"} />
        </section>
      </div>
    </main>
  );
}
