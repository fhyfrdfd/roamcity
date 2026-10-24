import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/api-guards";
import { DouyinOpenError, fetchDouyinHotTravel } from "@/services/social/douyin-open";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  city: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(120).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "social");
  if (limited) return limited;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "需要城市名称" } }, { status: 400 });
  try {
    const result = await fetchDouyinHotTravel(parsed.data.city, parsed.data.query);
    return NextResponse.json({ ok: true, data: result, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logger.warn("douyin-hot.failed", { code: error instanceof DouyinOpenError ? error.code : "UNKNOWN", error });
    const code = error instanceof DouyinOpenError ? error.code : "REQUEST_FAILED";
    const status = code === "NOT_CONFIGURED" ? 503 : code === "PERMISSION_REQUIRED" ? 403 : 502;
    return NextResponse.json({ ok: false, error: { code, message: error instanceof Error ? error.message : "抖音热榜分析失败" } }, { status, headers: { "cache-control": "no-store" } });
  }
}
