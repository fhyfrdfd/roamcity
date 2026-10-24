"use client";

import { ItineraryPanel } from "@/components/itinerary/ItineraryPanel";
import { MobileTripSheet } from "@/components/itinerary/MobileTripSheet";

export default function TripPage() {
  return (
    <div className="flex h-full flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] desk:pb-0">
      <div className="hidden h-full desk:block">
        <ItineraryPanel />
      </div>
      <div className="relative h-full desk:hidden">
        <MobileTripSheet />
      </div>
    </div>
  );
}
