import { create } from "zustand";
import { toast } from "sonner";
import { chongqingTrip } from "@/data/demo/chongqing";
import { tripRepository } from "@/services/trips/repository";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import { useHistoryStore } from "@/store/history-store";
import { ApiError, runCommand } from "@/lib/api-client";
import type { Trip } from "@/types/travel";

interface TripState {
  trip: Trip;
  revision: number;
  saving: boolean;
  setTrip: (trip: Trip, revision?: number) => void;
  patchTrip: (updater: (trip: Trip) => Trip) => void;
  reorder: (dayId: string, orderedIds: string[]) => void;
  persist: () => Promise<void>;
}

export const useTripStore = create<TripState>((set, get) => ({
  trip: structuredClone(chongqingTrip),
  revision: 1,
  saving: false,
  setTrip: (trip, revision) => set((state) => ({ trip, revision: revision ?? state.revision + 1 })),
  patchTrip: (updater) => set({ trip: updater(get().trip) }),
  reorder: (dayId, orderedIds) => {
    const trip = get().trip;
    // Snapshot for rollback: a failed server round-trip must not leave the
    // optimistic order silently diverging from what the runtime holds.
    const snapshot = structuredClone(trip);
    const items = trip.items.map((item) => {
      if (item.dayId !== dayId) return item;
      const order = orderedIds.indexOf(item.id);
      return order === -1 ? item : { ...item, order };
    });
    const estimated = recomputeDay({ ...trip, items }, dayId);
    set({ trip: estimated });
    void runCommand<{ trip?: Trip; revision?: number }>("reorder-day", { tripId: estimated.id, dayId, orderedItemIds: orderedIds, expectedTripRevision: get().revision })
      .then((data) => {
        if (data.trip) {
          set({ trip: data.trip, ...(data.revision !== undefined ? { revision: data.revision } : {}) });
          return;
        }
        set({ trip: snapshot });
        toast.error("排序没有保存成功，已恢复原顺序");
      })
      .catch((error) => {
        set({ trip: snapshot });
        if (error instanceof ApiError && error.code === "REVISION_CONFLICT") {
          // The trip moved on (another tab or the assistant). Re-sync instead
          // of leaving a stale revision that would fail every later write.
          toast.error("行程已在别处更新，已同步最新版本，请重试");
          void resyncTrip(estimated.id);
          return;
        }
        toast.error(error instanceof ApiError ? error.message : "网络异常，排序没有保存成功，已恢复原顺序");
      });
  },
  persist: async () => {
    set({ saving: true });
    try {
      const saved = await tripRepository.save(get().trip);
      set({ trip: saved });
    } catch (cause) {
      console.warn("voyage: local trip persist failed", cause);
      toast.error("本地保存失败，行程修改可能无法在刷新后保留");
    } finally {
      set({ saving: false });
    }
  },
}));

export function hydrateTrip(trip: Trip, revision = 1) {
  // Undo snapshots belong to one trip: switching trips without dropping the
  // stack would let a stale snapshot overwrite the new trip server-side.
  if (useTripStore.getState().trip.id !== trip.id) useHistoryStore.getState().reset();
  useTripStore.setState({ trip: recomputeTrip(trip), revision });
}

/** Pulls the authoritative trip+revision after a conflict so writes unblock. */
export function resyncTrip(tripId: string) {
  void runCommand<{ trip?: Trip; revision?: number }>("get-trip", { tripId })
    .then((data) => {
      // A failed envelope must never overwrite local state with nothing.
      if (data.trip) useTripStore.setState({ trip: recomputeTrip(data.trip), revision: data.revision ?? 1 });
    })
    .catch(() => undefined);
}
