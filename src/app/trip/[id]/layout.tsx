"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { TripShell } from "@/components/layout/TripShell";
import { MapCanvas } from "@/components/map/MapCanvas";
import { toast } from "sonner";
import { hydrateTrip } from "@/store/trip-store";
import { useTripStore } from "@/store/trip-store";
import { OfflineJourneyCache } from "@/features/journey-map/services/offline-cache";
import type { MapMode } from "@/features/journey-map/models/map-state";
import type { Trip } from "@/types/travel";
import { ApiError, postJson, runCommand } from "@/lib/api-client";

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const loadedTripId = useTripStore((state) => state.trip.id);

  useEffect(() => {
    void (async () => {
      try {
        const data = await runCommand<{ trip?: Trip; revision?: number }>("get-trip", { tripId: params.id });
        if (data.trip) {
          hydrateTrip(data.trip, data.revision);
          return;
        }
      } catch {
        // The guest workspace may not hold it; try the legacy import below.
      }
      try {
        const legacy = await postJson<{ trip?: Trip; revision?: number }>("/api/voyage/import", { tripId: params.id });
        if (legacy.trip) {
          hydrateTrip(legacy.trip, legacy.revision);
          OfflineJourneyCache.cacheTrip(legacy.trip).catch(() => {});
          return;
        }
        toast.error("行程不存在，返回列表页");
        router.replace("/trips");
      } catch (error) {
        // An HTTP answer means "no such trip"; only a transport failure is an
        // offline candidate.
        if (error instanceof ApiError && error.status !== undefined) {
          toast.error("行程不存在，返回列表页");
          router.replace("/trips");
          return;
        }
        const offlineTrip = await OfflineJourneyCache.getCachedTrip(params.id).catch(() => undefined);
        if (offlineTrip) {
          hydrateTrip(offlineTrip, undefined);
          setOffline(true);
          toast("无网络，已加载离线行程包");
        } else {
          toast.error("无网络且无离线行程包，无法查看");
          router.replace("/trips");
        }
      }
    })();
  }, [params.id, router]);

  const mapMode: MapMode = useMemo(() => {
    if (pathname.includes("/today")) return "TODAY";
    if (pathname.includes("/explore")) return "EXPLORE";
    return "PLAN";
  }, [pathname]);

  if (loadedTripId !== params.id) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground" role="status">
        正在加载行程…
      </div>
    );
  }

  return (
    <TripShell tripId={params.id} map={<MapCanvas mode={mapMode} theme={resolvedTheme === "light" ? "light" : "dark"} />}>
      {offline ? (
        <p className="border-b border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-center text-[11px] text-amber-800 dark:text-amber-200">
          离线模式：正在显示已下载的离线包内容，写入操作暂不可用。
        </p>
      ) : null}
      {children}
    </TripShell>
  );
}