import { haversineMeters } from "@/lib/utils";
import type { Outline } from "@/services/planning/outline-planner";
import type { Place } from "@/types/travel";

export interface OutlineRepairResult {
  outline: Outline;
  repairs: string[];
}

function addMinutes(time: string, duration: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour ?? 0) * 60 + (minute ?? 0) + duration;
  return String(Math.floor(total / 60) % 24).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

function timeMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** Repairs only choices available in the provider candidate set. */
export function repairOutlineForTrust(outline: Outline, candidates: Place[]): OutlineRepairResult {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const used = new Set<string>();
  const repairs: string[] = [];
  const dayPlans = outline.dayPlans.map((day, dayIndex) => {
    const stops = day.stops.filter((stop) => {
      if (!byId.has(stop.placeId)) return false;
      if (used.has(stop.placeId)) {
        repairs.push("Day " + (dayIndex + 1) + " 移除了重复地点");
        return false;
      }
      used.add(stop.placeId);
      return true;
    });
    const hasMeal = () => stops.some((stop) => {
      const candidate = byId.get(stop.placeId);
      const start = timeMinutes(stop.startTime);
      return stop.meal === "lunch" || stop.meal === "dinner" || (candidate?.category === "food" && start >= 11 * 60 && start < 22 * 60);
    });
    const choose = (mealOnly: boolean, anchor?: Place) => candidates
      .filter((candidate) => !used.has(candidate.id) && (!mealOnly || candidate.category === "food"))
      .sort((a, b) => {
        if (!anchor) return Number(b.category === "food") - Number(a.category === "food") || b.rating - a.rating;
        return haversineMeters(anchor, a) - haversineMeters(anchor, b);
      })[0];

    if (!hasMeal()) {
      const last = [...stops].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime)).at(-1);
      const mealPlace = choose(true, last ? byId.get(last.placeId) : undefined);
      if (mealPlace) {
        stops.push({ placeId: mealPlace.id, startTime: "12:00", durationMinutes: mealPlace.stayMinutes || 60, meal: "lunch" });
        used.add(mealPlace.id);
        repairs.push("Day " + (dayIndex + 1) + " 补入候选正餐地点");
      }
    }

    while (stops.length < 3) {
      const last = [...stops].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime)).at(-1);
      const anchor = last ? byId.get(last.placeId) : undefined;
      const needMeal = !hasMeal();
      const candidate = choose(needMeal, anchor) ?? choose(false, anchor);
      if (!candidate) break;
      const nextStart = last ? addMinutes(last.startTime, last.durationMinutes + 35) : "09:00";
      const isMeal = needMeal && candidate.category === "food";
      stops.push({
        placeId: candidate.id,
        startTime: isMeal ? "12:00" : nextStart,
        durationMinutes: candidate.stayMinutes || 60,
        ...(isMeal ? { meal: "lunch" as const } : {}),
      });
      used.add(candidate.id);
      repairs.push("Day " + (dayIndex + 1) + " 补入候选地点" + (isMeal ? "并覆盖正餐" : ""));
    }
    return { ...day, stops: stops.sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime)) };
  });
  return { outline: { ...outline, dayPlans }, repairs: [...new Set(repairs)] };
}
