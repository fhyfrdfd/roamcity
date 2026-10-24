import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";
import { buildTrustMetadata } from "@/services/trust";
import { guestWorkspace, setGuestCookie } from "../workspace";
import { enforceRateLimit } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "read");
  if (limited) return limited;
  const workspace = guestWorkspace(request);
  const body = await request.json().catch(() => null) as { tripId?: unknown } | null;
  if (typeof body?.tripId !== "string" || !body.tripId.trim()) {
    return setGuestCookie(NextResponse.json({ ok: false, error: "tripId is required" }, { status: 400 }), workspace);
  }
  const stored = await new JsonSkillRepository(workspace.root).getTrip(body.tripId);
  if (!stored) return setGuestCookie(NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 }), workspace);
  const trust = buildTrustMetadata(stored.trip, stored.trip.planningMetadata?.planningProfile);
  return setGuestCookie(NextResponse.json({ ok: true, tripId: stored.trip.id, revision: stored.revision, ...trust }, { headers: { "cache-control": "no-store" } }), workspace);
}
