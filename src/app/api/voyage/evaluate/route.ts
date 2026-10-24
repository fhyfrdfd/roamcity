import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";
import { runTrustEvaluation, taskSchema } from "@/services/evaluation/trust-evaluation";

export const dynamic = "force-dynamic";
// A full evaluation calls AMap + the LLM once per task, so keep the window
// generous for dev runs; the default is capped to one task.
export const maxDuration = 300;

const bodySchema = z
  .object({
    tasks: z.array(taskSchema).min(1).max(3).optional(),
    skipBaseline: z.boolean().optional(),
    checkBaselineRoutes: z.boolean().optional(),
  })
  .strict();

/**
 * Dev-only evaluation endpoint. It runs the same code path as
 * `npm run eval:trust` but never writes the benchmark reports and never runs
 * the full 20-task dataset unless tasks are supplied explicitly.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "EVALUATE_DISABLED", message: "评测接口仅在开发环境可用" }, { status: 403 });
  }

  const limited = enforceRateLimit(request, "evaluate");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "tasks 校验失败", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  try {
    const report = await runTrustEvaluation({
      ...(parsed.data.tasks ? { tasks: parsed.data.tasks } : { limit: 1 }),
      skipBaseline: parsed.data.skipBaseline ?? false,
      // Per-hop AMap route checks multiply upstream calls; HTTP callers can opt in.
      checkBaselineRoutes: parsed.data.checkBaselineRoutes ?? false,
      quiet: true,
      persist: false,
    });
    return NextResponse.json({ ok: true, report }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logger.error("evaluate.failed", { error });
    return NextResponse.json(
      { ok: false, error: { code: "EVALUATION_FAILED", message: error instanceof Error ? error.message : "评测失败" } },
      { status: 500 },
    );
  }
}
