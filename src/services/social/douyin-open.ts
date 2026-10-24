import { runtimeConfigSync } from "@/services/config/local-credentials";

const API_ORIGIN = "https://open.douyin.com";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_SEARCH_RESULTS = 20;
const MAX_HOT_VIDEOS = 5;
const MAX_COMMENTS_PER_VIDEO = 50;

type Row = Record<string, unknown>;

export interface DouyinCommentAnalysis {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  positiveRate: number;
  negativeRate: number;
  themes: Array<{ label: string; count: number }>;
  highlights: string[];
  summary: string;
}

export interface DouyinHotVideo {
  platform: "douyin";
  sourceId: string;
  sourceUrl: string;
  summary: string;
  content: string;
  publishedAt?: string;
  fetchedAt: string;
  metrics: Record<string, number>;
  heatScore: number;
  commentAnalysis: DouyinCommentAnalysis;
}

export interface DouyinHotResult {
  videos: DouyinHotVideo[];
  warnings: string[];
}

export class DouyinOpenError extends Error {
  constructor(message: string, readonly code: "NOT_CONFIGURED" | "AUTH_FAILED" | "PERMISSION_REQUIRED" | "REQUEST_FAILED") {
    super(message);
    this.name = "DouyinOpenError";
  }
}

function record(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function rows(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = record(payload);
  if (!root) return [];
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  for (const key of ["data", "result"]) {
    const nested = record(root[key]);
    if (nested) {
      const found = rows(nested, keys);
      if (found.length) return found;
    }
  }
  return [];
}

async function request(path: string, options: { token?: string; body?: Row; method?: "GET" | "POST" } = {}) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new DouyinOpenError("抖音请求地址无效", "REQUEST_FAILED");
  // Douyin OpenAPI accepts the app token as a query parameter on these
  // business endpoints. Keep the secret itself server-side at all times.
  if (options.token && path !== "/oauth/client_token/") url.searchParams.set("access_token", options.token);
  const response = await fetch(url, {
    method: options.method ?? "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Row;
  const errorCode = number(payload.error_code ?? record(payload.data)?.error_code);
  const description = text(payload.description ?? payload.message ?? record(payload.data)?.description) ?? "抖音开放平台请求失败";
  if (response.status === 401 || response.status === 403 || errorCode === 10008) {
    throw new DouyinOpenError("抖音应用鉴权失败，请检查 Client Key 与 Client Secret", "AUTH_FAILED");
  }
  if (errorCode || !response.ok) {
    const permission = /scope|权限|permission|未授权/i.test(description);
    throw new DouyinOpenError(permission ? `抖音接口权限不足：${description}` : description, permission ? "PERMISSION_REQUIRED" : "REQUEST_FAILED");
  }
  return payload;
}

async function clientToken() {
  const clientKey = runtimeConfigSync("DOUYIN_CLIENT_KEY");
  const clientSecret = runtimeConfigSync("DOUYIN_CLIENT_SECRET");
  if (!clientKey || !clientSecret) {
    throw new DouyinOpenError("需要先配置 DOUYIN_CLIENT_KEY 和 DOUYIN_CLIENT_SECRET", "NOT_CONFIGURED");
  }
  const payload = await request("/oauth/client_token/", {
    body: { client_key: clientKey, client_secret: clientSecret, grant_type: "client_credential" },
  });
  const token = text(record(payload.data)?.access_token ?? payload.access_token);
  if (!token) throw new DouyinOpenError("抖音开放平台未返回 client_token", "AUTH_FAILED");
  return token;
}

function normalizeVideo(value: unknown, city: string) {
  const row = record(value);
  if (!row) return null;
  const item = record(row.video) ?? record(row.item) ?? row;
  const sourceId = text(item.item_id ?? item.item_id_str ?? item.aweme_id ?? item.video_id ?? item.id);
  const description = text(item.title ?? item.desc ?? item.description ?? row.title) ?? "抖音旅游视频";
  if (!sourceId) return null;
  const stats = record(item.statistics) ?? record(item.stats) ?? item;
  const metrics = {
    likes: number(stats.digg_count ?? stats.like_count ?? stats.likes),
    comments: number(stats.comment_count ?? stats.comments),
    shares: number(stats.share_count ?? stats.shares),
    views: number(stats.play_count ?? stats.view_count ?? stats.views),
  };
  const rawTime = number(item.create_time ?? item.publish_time ?? item.published_at);
  const publishedAt = rawTime ? new Date(rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime).toISOString() : undefined;
  const relevance = description.includes(city) ? 1 : /旅游|旅行|攻略|打卡|景点|美食|探店|路线/.test(description) ? 0.8 : 0.45;
  return { sourceId, description, metrics, publishedAt, relevance };
}

function heatScore(video: { metrics: Record<string, number>; publishedAt?: string; relevance: number }) {
  const { likes = 0, comments = 0, shares = 0, views = 0 } = video.metrics;
  const interactions = likes + comments * 3 + shares * 4 + views * 0.02;
  const ageDays = video.publishedAt ? Math.max(0, (Date.now() - Date.parse(video.publishedAt)) / 86_400_000) : 30;
  const freshness = Math.max(0.65, 1 - Math.min(ageDays, 365) / 1000);
  return Math.round(Math.log10(interactions + 10) * 1000 * freshness * video.relevance) / 1000;
}

function normalizeComments(payload: unknown) {
  return rows(payload, ["list", "comments", "comment_list"]).flatMap((value) => {
    const row = record(value);
    const content = text(row?.content ?? row?.text ?? row?.comment);
    return content ? [content.slice(0, 300)] : [];
  }).slice(0, MAX_COMMENTS_PER_VIDEO);
}

const POSITIVE = /推荐|值得|好看|好吃|惊艳|方便|舒服|喜欢|绝了|不错|很美|划算|宝藏|必去|必吃/;
const NEGATIVE = /避雷|踩雷|不推荐|难吃|失望|排队|拥挤|人多|贵|坑|关闭|施工|不值|绕路|堵/;
const THEMES: Array<[string, RegExp]> = [
  ["推荐", /推荐|值得|必去|必吃|宝藏/], ["美食", /好吃|难吃|餐厅|小吃|火锅|美食|探店/],
  ["拥挤排队", /人多|拥挤|排队|堵/], ["价格", /价格|人均|便宜|划算|贵|门票|元/],
  ["交通", /地铁|公交|打车|停车|交通|步行|走路/], ["避坑", /避雷|踩雷|不推荐|坑|失望/],
  ["拍照景色", /拍照|出片|机位|夜景|风景|好看|很美/], ["开放信息", /营业|关闭|施工|预约|开放时间/],
];

export function analyzeDouyinComments(comments: string[]): DouyinCommentAnalysis {
  let positive = 0;
  let negative = 0;
  const themeCounts = new Map<string, number>();
  for (const comment of comments) {
    const isPositive = POSITIVE.test(comment);
    const isNegative = NEGATIVE.test(comment);
    if (isPositive && !isNegative) positive += 1;
    else if (isNegative && !isPositive) negative += 1;
    for (const [label, pattern] of THEMES) if (pattern.test(comment)) themeCounts.set(label, (themeCounts.get(label) ?? 0) + 1);
  }
  const total = comments.length;
  const neutral = Math.max(0, total - positive - negative);
  const themes = [...themeCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const highlights = comments.filter((comment) => comment.length >= 6 && THEMES.some(([, pattern]) => pattern.test(comment))).slice(0, 5);
  const positiveRate = total ? Math.round(positive / total * 100) / 100 : 0;
  const negativeRate = total ? Math.round(negative / total * 100) / 100 : 0;
  const themeText = themes.length ? `主要讨论：${themes.map((theme) => `${theme.label} ${theme.count} 条`).join("、")}` : "暂未提取出明确旅游主题";
  return { total, positive, negative, neutral, positiveRate, negativeRate, themes, highlights, summary: `分析 ${total} 条评论，正向 ${Math.round(positiveRate * 100)}%，负向 ${Math.round(negativeRate * 100)}%；${themeText}` };
}

async function commentsForVideo(token: string, sourceId: string) {
  const payload = await request("/video/search/comment/list/", {
    token,
    body: { item_id: sourceId, count: MAX_COMMENTS_PER_VIDEO, cursor: 0 },
  });
  return normalizeComments(payload);
}

export async function fetchDouyinHotTravel(city: string, query = `${city} 旅游攻略`): Promise<DouyinHotResult> {
  const token = await clientToken();
  const payload = await request("/video/search/", {
    token,
    body: { keyword: query, count: MAX_SEARCH_RESULTS, cursor: 0 },
  });
  const ranked = rows(payload, ["list", "video_list", "videos", "items"])
    .map((value) => normalizeVideo(value, city))
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .map((video) => ({ ...video, heatScore: heatScore(video) }))
    .sort((a, b) => b.heatScore - a.heatScore)
    .slice(0, MAX_HOT_VIDEOS);
  if (!ranked.length) return { videos: [], warnings: ["抖音搜索成功，但没有返回与该城市旅游相关的视频"] };

  const warnings: string[] = [];
  const fetchedAt = new Date().toISOString();
  const videos = await Promise.all(ranked.map(async (video): Promise<DouyinHotVideo> => {
    let comments: string[] = [];
    try { comments = await commentsForVideo(token, video.sourceId); }
    catch (error) { warnings.push(`视频 ${video.sourceId} 的评论暂时不可用：${error instanceof Error ? error.message : "请求失败"}`); }
    const analysis = analyzeDouyinComments(comments);
    const commentContext = analysis.highlights.length ? `\n评论中的旅游反馈：${analysis.highlights.join("；")}` : "";
    return {
      platform: "douyin", sourceId: video.sourceId,
      sourceUrl: `https://www.douyin.com/video/${video.sourceId}`,
      summary: video.description.slice(0, 160),
      content: `${video.description}${commentContext}`.slice(0, 2000),
      publishedAt: video.publishedAt, fetchedAt, metrics: video.metrics,
      heatScore: video.heatScore, commentAnalysis: analysis,
    };
  }));
  return { videos, warnings };
}
