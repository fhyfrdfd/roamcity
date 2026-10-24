"use client";

import { CommandPalette } from "./CommandPalette";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { motion, useReducedMotion } from "motion/react";

export function TripShell({
  tripId,
  children,
  map,
}: {
  tripId: string;
  children: React.ReactNode;
  map?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar tripId={tripId} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="relative flex min-h-0 flex-1">
            <section className="absolute inset-0 hidden min-w-0 desk:block" aria-label="地图工作区">
              {map}
            </section>
            <motion.main
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 flex min-h-0 w-full min-w-0 flex-col bg-surface desk:m-3 desk:w-[460px] desk:max-w-[520px] desk:shrink-0 desk:overflow-hidden desk:rounded-[14px] desk:border desk:border-border desk:shadow-[var(--shadow-panel)] lg:w-[500px]"
            >
              {children}
            </motion.main>
          </div>
        </div>
        <CommandPalette />
        <MobileNav tripId={tripId} />
      </div>
    </TooltipProvider>
  );
}
