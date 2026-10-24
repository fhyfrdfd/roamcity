"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { motion, useReducedMotion } from "motion/react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { ItineraryPanel } from "./ItineraryPanel";
import { useUiStore } from "@/store/ui-store";
import type { MapMode } from "@/features/journey-map/models/map-state";

const HEIGHT = { collapsed: "22%", half: "52%", full: "88%" } as const;
// Landscape phones (and other very short viewports) cannot afford an 88%
// panel plus the top bar and tab bar; give the panel the full remaining box.
const COMPACT_HEIGHT = { collapsed: "32%", half: "70%", full: "96%" } as const;

export function MobileTripSheet() {
  const snap = useUiStore((s) => s.sheetSnap);
  const setSnap = useUiStore((s) => s.setSheetSnap);
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-height: 540px)");
    const apply = () => setCompact(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const heights = compact ? COMPACT_HEIGHT : HEIGHT;

  const mapMode: MapMode = useMemo(() => {
    if (pathname.includes("/today")) return "TODAY";
    if (pathname.includes("/explore")) return "EXPLORE";
    return "PLAN";
  }, [pathname]);

  return (
    <div className="relative h-full bg-[var(--map-land)]">
      <div className="absolute inset-0">
        <MapCanvas mode={mapMode} theme={resolvedTheme === "light" ? "light" : "dark"} />
      </div>
      <motion.div
        data-testid="trip-sheet"
        className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-t-[14px] border-t border-border bg-surface shadow-[var(--shadow-float)]"
        animate={{ height: heights[snap] }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 32 }}
      >
        <button
          type="button"
          data-testid="trip-sheet-handle"
          className="touch-target flex w-full justify-center py-2"
          aria-label="调整行程面板高度"
          onClick={() => setSnap(snap === "collapsed" ? "half" : snap === "half" ? "full" : "collapsed")}
        >
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </button>
        <div className="h-[calc(100%-28px)] overflow-hidden">
          <ItineraryPanel />
        </div>
      </motion.div>
    </div>
  );
}
