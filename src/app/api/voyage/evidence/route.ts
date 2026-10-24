import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";
import { buildEvidenceCards } from "@/services/trust";
import { guestWorkspace, setGuestCookie } from "../workspace";
import { enforceRateLimit } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "read");
  if (limited) return limited;
  const workspace = guestWorkspace(request);
  const tripId = request.nextUrl.searchParams.get("tripId")?.trim();
  if (!tripId) return setGuestCookie(NextResponse.json({ ok: false, error: "tripId is required" }, { status: 400 }), workspace);
  const stored = await new JsonSkillRepository(workspace.root).getTrip(tripId);
  if (!stored) return setGuestCookie(NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 }), workspace);
  return setGuestCookie(NextResponse.json({ ok: true, tripId: stored.trip.id, revision: stored.revision, cards: buildEvidenceCards(stored.trip) }, { headers: { "cache-control": "no-store" } }), workspace);
}
