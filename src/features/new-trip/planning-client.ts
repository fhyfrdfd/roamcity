import { MAX_TRIP_DAYS } from "@/lib/trip-limits";
import { ApiError } from "@/lib/api-client";
import type { PlanningProfileDraft } from "@/components/planning/types";

/** Days between two ISO dates, inclusive; undefined when the range is invalid. */
export function draftDateSpan(profile: PlanningProfileDraft) {
  if (!profile.startDate || !profile.endDate) return undefined;
  const start = Date.parse(`${profile.startDate}T12:00:00Z`);
  const end = Date.parse(`${profile.endDate}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/**
 * A date range that cannot become a trip is a blocker, not a warning. A past
 * departure is only warned about, because planning a trip that already started
 * is a legitimate choice.
 */
export function dateRangeWarning(profile: PlanningProfileDraft) {
  const span = draftDateSpan(profile);
  if (span !== undefined && span > MAX_TRIP_DAYS) {
    return `出发与返程相隔 ${span} 天，超过可生成的上限 ${MAX_TRIP_DAYS} 天，请确认日期是否填错。`;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (profile.startDate && profile.startDate < today) {
    return `出发日期 ${profile.startDate} 已经过去，如果不是有意的请重新选择。`;
  }
  return "";
}

/**
 * Preconditions the generate endpoint enforces. Reads the same shared constant
 * the server does, so the panel can never again allow a plan the runtime will
 * refuse (the two caps once drifted: 31 client vs 7 server).
 */
export function generateBlockersFor(profile: PlanningProfileDraft, days?: number) {
  const blockers: string[] = [];
  if (!profile.destination.trim()) blockers.push("目的地");
  if (!profile.startDate) blockers.push("出发日期");
  if (!profile.endDate && !days) blockers.push("返程日期或旅行天数");
  const span = draftDateSpan(profile);
  if (span !== undefined && span > MAX_TRIP_DAYS) blockers.push("日期跨度");
  return blockers;
}

function listFromDraft(value: string) {
  return value.split(/[,，、；;]+/).map((item) => item.trim()).filter(Boolean);
}

function asNumber(value: string) {
  if (!value.trim()) return undefined;
  const number = Number(value.replace(/[,，¥￥\s]/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

/** The structured profile patch sent with each conversational turn. */
export function profilePatchFromDraft(profile: PlanningProfileDraft) {  const pace = profile.pace === "轻松留白" ? "relaxed" : profile.pace === "刚好充实" ? "balanced" : profile.pace === "特种兵一点" ? "packed" : undefined;
  const walkingTolerance = profile.walkingTolerance === "少走路" ? "low" : profile.walkingTolerance === "适中" ? "medium" : profile.walkingTolerance === "可以多走一点" ? "high" : undefined;
  const transportPreference = profile.transportPreference === "公共交通优先" ? "public" : profile.transportPreference === "混合安排" ? "mixed" : profile.transportPreference === "打车更方便" ? "taxi" : undefined;
  const budgetMode = profile.budgetMode === "灵活" || profile.budgetMode === "宽松" || profile.budgetMode === "flexible" ? "flexible" : profile.budgetMode === "紧凑" || profile.budgetMode === "省钱" || profile.budgetMode === "tight" ? "tight" : profile.budgetMode === "适中" || profile.budgetMode === "平衡" || profile.budgetMode === "balanced" ? "balanced" : undefined;
  const travelers = asNumber(profile.travelers);
  const budget = asNumber(profile.budget);
  return {
    ...(profile.origin.trim() ? { origin: profile.origin.trim() } : {}),
    ...(profile.destination.trim() ? { destination: profile.destination.trim() } : {}),
    ...(profile.startDate ? { startDate: profile.startDate } : {}),
    ...(profile.endDate ? { endDate: profile.endDate } : {}),
    ...(travelers !== undefined ? { travelers } : {}),
    ...(budget !== undefined ? { budget } : {}),
    ...(pace ? { pace } : {}),
    ...(walkingTolerance ? { walkingTolerance } : {}),
    ...(transportPreference ? { transportPreference } : {}),
    ...(budgetMode ? { budgetMode } : {}),
    ...(profile.vibes.length ? { vibes: profile.vibes } : {}),
    ...(profile.mustVisit.trim() ? { mustVisit: listFromDraft(profile.mustVisit) } : {}),
    ...(profile.avoid.trim() ? { avoid: listFromDraft(profile.avoid) } : {}),
    includeExternalOffers: profile.includeOffers,
    socialOptIn: profile.includeSocialEvidence,
  };
}

/**
 * Provider failures must read as actionable Chinese guidance. Raw provider
 * text is English and leaks no credentials, but it does not tell the traveller
 * what to do next.
 */
const PROVIDER_ERROR_COPY: Array<{ test: RegExp; message: string }> = [
  { test: /NO_PROVIDER_CONFIGURED/, message: "尚未配置高德服务端 Key。请在设置页配置 AMAP_SERVER_KEY 后再生成真实路线。" },
  { test: /PROVIDER_AUTH_FAILED|AMAP_INVALID_USER_KEY/, message: "高德 Web 服务 Key 无效或未开通 POI 服务，请检查控制台的 Key 类型、服务权限和安全设置。" },
  { test: /AMAP_NETWORK_UNAVAILABLE/, message: "高德服务连接失败（不是没有地点结果）。请检查本机网络/代理后重试；如果服务刚启动，请刷新页面再试。" },
  { test: /ROUTE_PROVIDER_UNAVAILABLE/, message: "高德路线服务暂时不可用；可重试，行程中的路线会明确标记为估算。" },
  { test: /REVISION_CONFLICT/, message: "这条规划刚刚在其他页面更新了。已同步最新版本，可以再点一次生成。" },
  { test: /CONFIRMATION_REQUIRED/, message: "生成路线图需要你在页面上明确确认一次，请重新点击按钮。" },
  { test: /PLANNING_SESSION_LOCKED/, message: "这次规划正在后台生成中，完成后行程会出现在「我的旅行」，稍等片刻即可。" },
  { test: /PLANNING_SESSION_COMPLETED/, message: "这次规划已经完成，直接去「我的旅行」查看行程。" },
  { test: /PLANNING_SESSION_NOT_FOUND/, message: "这次规划会话已失效，请重新开始对话。" },
  { test: /INVALID_INPUT/, message: "规划信息不完整，请补充目的地、出发日期与返程信息。" },
];

/** Maps a transport-layer failure onto actionable copy (conflict/5xx/network). */
export function friendlyApiError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const haystack = `${error.code ?? ""} ${error.message}`;
    const match = PROVIDER_ERROR_COPY.find((entry) => entry.test.test(haystack));
    if (match) return match.message;
    if ((error.status ?? 0) >= 500) return "规划服务暂时不可用，请稍后重试；浏览器没有接触任何服务凭据。";
    return error.message || fallback;
  }
  if (error instanceof Error && error.name === "TimeoutError") return "规划服务响应超时，请稍后重试。";
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The revision the server actually holds, when it rejects a stale write.
 * Error bodies are either `{ error: { details: { revision } } }` or carry
 * `revision` at the top level; both are accepted so a retry can resync.
 */
export function revisionFromFailure(error: unknown) {
  if (!(error instanceof ApiError) || typeof error.details !== "object" || error.details === null) return undefined;
  const root = error.details as Record<string, unknown>;
  const errorNode = typeof root.error === "object" && root.error !== null ? root.error as Record<string, unknown> : undefined;
  const detailNode = errorNode && typeof errorNode.details === "object" && errorNode.details !== null
    ? errorNode.details as Record<string, unknown>
    : root;
  const raw = detailNode.revision ?? root.revision;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;
}
