/**
 * Typed client-side transport for Voyage API endpoints.
 *
 * Two response families exist:
 *  - standard skill envelopes (`{ ok, data?, error? }`) for command/planning routes
 *  - raw JSON (`{ ok: true, trips }`, `{ configured }`, route payloads) for the
 *    lighter routes
 *
 * Both helpers below check `response.ok`, parse the error body when present and
 * throw an `ApiError` carrying status/code/details. A 5xx HTML page must never
 * surface as "网络异常" — that message is reserved for actual fetch failures.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Standard envelope as answered by /api/voyage/* endpoints. */
export interface VoyageEnvelope<T> {
  ok?: boolean;
  data?: T;
  warnings?: string[];
  error?: { code?: string; message?: string; details?: unknown };
}

export interface RequestOptions {
  networkMessage?: string;
  signal?: AbortSignal;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureFromBody(body: unknown, response: Response): { code?: string; message: string } {
  if (isRecord(body)) {
    const error = body.error;
    if (typeof error === "string" && error.trim()) {
      // Some routes use a machine code ("TRIP_NOT_FOUND"), others a ready
      // Chinese message; surface the latter as-is.
      const human = /[一-鿿]/.test(error);
      return { code: error, message: human ? error : `请求失败（HTTP ${response.status}）` };
    }
    if (isRecord(error)) {
      const message = typeof error.message === "string" && error.message.trim()
        ? error.message
        : `请求失败（HTTP ${response.status}）`;
      return { code: typeof error.code === "string" ? error.code : undefined, message };
    }
    if (typeof body.message === "string" && body.message.trim()) return { message: body.message };
    if (typeof body.warning === "string" && body.warning.trim()) return { message: body.warning };
  }
  return { message: `请求失败（HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}）` };
}

function networkError(options: RequestOptions) {
  return new ApiError(options.networkMessage ?? "网络异常，请重试");
}

function isAbort(error: unknown) {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Fetch JSON with status checking. Throws `ApiError` for network failures,
 * non-2xx responses and `{ ok: false }` bodies (even with HTTP 200).
 */
export async function requestJson<T>(url: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw networkError(options);
  }
  const body = await readBody(response);
  if (isRecord(body) && body.ok === false) {
    const failure = failureFromBody(body, response);
    throw new ApiError(failure.message, failure.code, response.status, body);
  }
  if (!response.ok) {
    const failure = failureFromBody(body, response);
    throw new ApiError(failure.message, failure.code, response.status, body);
  }
  if (typeof body === "string") {
    // A 2xx HTML page usually means a proxy or a rewritten route answered
    // instead of the API; returning it would fail later with a TypeError.
    throw new ApiError("服务返回了非 JSON 响应", undefined, response.status, body);
  }
  return body as T;
}

export function getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  return requestJson<T>(url, { method: "GET" }, options);
}

export function postJson<T>(url: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  return requestJson<T>(url, { method: "POST", body: JSON.stringify(body) }, options);
}

export function deleteJson<T>(url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return requestJson<T>(url, { method: "DELETE", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, options);
}

/**
 * Posts JSON and returns the parsed envelope. Business failures (4xx with a
 * voyage envelope) are returned, not thrown, so callers can inspect `ok`.
 * A non-envelope 5xx or an unparseable success body throws.
 */
export async function postEnvelope<T>(url: string, body: unknown, options: RequestOptions = {}): Promise<VoyageEnvelope<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw networkError(options);
  }
  const payload = await readBody(response);
  if (isRecord(payload) && typeof payload.ok === "boolean") return payload as VoyageEnvelope<T>;
  if (!response.ok) {
    const failure = failureFromBody(payload, response);
    throw new ApiError(failure.message, failure.code, response.status, payload);
  }
  throw new ApiError("服务返回了无法识别的响应", undefined, response.status, payload);
}

/** Envelope helper for callers that only care about `data` and want errors thrown. */
export async function postEnvelopeData<T>(url: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const envelope = await postEnvelope<T>(url, body, options);
  if (!envelope.ok || envelope.data === undefined) {
    throw new ApiError(envelope.error?.message ?? "操作失败，请重试", envelope.error?.code, undefined, envelope);
  }
  return envelope.data;
}

/** Like `postEnvelopeData`, but also surfaces top-level `warnings`. */
export async function postEnvelopeResult<T>(url: string, body: unknown, options: RequestOptions = {}): Promise<{ data: T; warnings: string[] }> {
  const envelope = await postEnvelope<T>(url, body, options);
  if (!envelope.ok || envelope.data === undefined) {
    throw new ApiError(envelope.error?.message ?? "操作失败，请重试", envelope.error?.code, undefined, envelope);
  }
  return { data: envelope.data, warnings: envelope.warnings ?? [] };
}

/** GET counterpart of `postEnvelopeData` for `{ ok, data }` routes. */
export async function getEnvelopeData<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await getJson<VoyageEnvelope<T>>(url, options);
  if (envelope.ok === false || envelope.data === undefined) {
    throw new ApiError(envelope.error?.message ?? "操作失败，请重试", envelope.error?.code, undefined, envelope);
  }
  return envelope.data;
}

/** Posts a runtime command and unwraps `data`, mapping failures to ApiError. */
export async function runCommand<T>(command: string, input: unknown, options: { networkMessage?: string; fallbackMessage?: string } = {}): Promise<T> {
  const envelope = await postEnvelope<T>("/api/voyage/command", { command, input }, options);
  if (!envelope.ok || envelope.data === undefined) {
    throw new ApiError(envelope.error?.message ?? options.fallbackMessage ?? "操作失败，请重试", envelope.error?.code, undefined, envelope);
  }
  return envelope.data;
}
