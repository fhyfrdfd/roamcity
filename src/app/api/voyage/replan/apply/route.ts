import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRuntime } from "@/skill/runtime";
import { errorEnvelope } from "@/skill/contracts";
import { SkillError } from "@/skill/errors";
import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";
import { guestWorkspace, setGuestCookie } from "../../workspace";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tripId: z.string().min(1),
  proposalId: z.string().min(1),
  proposalToken: z.string().min(1),
  baseRevision: z.number().int().min(1),
  confirmed: z.literal(true),
}).strict();

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "write");
  if (limited) return limited;
  const workspace = guestWorkspace(request);
  const reply = (body: unknown, status = 200) => setGuestCookie(NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }), workspace);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply(errorEnvelope("INVALID_INPUT", "A confirmed proposal is required", parsed.error.flatten()), 400);
  try {
    const result = await createRuntime(workspace.root).execute("apply-change", {
      tripId: parsed.data.tripId,
      proposalId: parsed.data.proposalId,
      proposalToken: parsed.data.proposalToken,
      expectedTripRevision: parsed.data.baseRevision,
      confirmed: true,
    });
    return reply(result);
  } catch (error) {
    if (error instanceof SkillError) return reply(errorEnvelope(error.code, error.message, error.details), 409);
    logger.error("replan.apply_failed", { error });
    return reply(errorEnvelope("INTERNAL_ERROR", "Trust replan apply failed"), 500);
  }
}
