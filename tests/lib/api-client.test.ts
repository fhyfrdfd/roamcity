import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  deleteJson,
  getEnvelopeData,
  getJson,
  postEnvelope,
  postEnvelopeData,
  postJson,
} from "@/lib/api-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function htmlResponse(status = 500) {
  return new Response("<html><body>upstream exploded</body></html>", { status, headers: { "content-type": "text/html" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postEnvelope", () => {
  it("returns a 4xx business envelope instead of throwing", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: { code: "REVISION_CONFLICT", message: "stale" } }, 409));
    vi.stubGlobal("fetch", fetchMock);
    const envelope = await postEnvelope<{ trip?: unknown }>("/api/voyage/command", { command: "x" });
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe("REVISION_CONFLICT");
  });

  it("turns a 5xx HTML page into a status error, not a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(502)));
    await expect(postEnvelope("/api/voyage/command", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      message: expect.stringContaining("HTTP 502"),
    });
    await expect(postEnvelope("/api/voyage/command", {})).rejects.not.toHaveProperty("message", "网络异常，请重试");
  });

  it("keeps the stable network message for real fetch failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(postEnvelope("/api/voyage/command", {}, { networkMessage: "无法连接本地服务" })).rejects.toMatchObject({
      name: "ApiError",
      message: "无法连接本地服务",
      status: undefined,
    });
  });
});

describe("requestJson helpers", () => {
  it("throws on HTTP 200 with ok:false and keeps code/details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, error: { code: "TRIP_NOT_FOUND", message: "行程不存在", details: { revision: 3 } } })));
    const error = await postJson("/api/voyage/command", {}).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "TRIP_NOT_FOUND", message: "行程不存在", status: 200 });
    expect((error as ApiError).details).toMatchObject({ error: { code: "TRIP_NOT_FOUND" } });
  });

  it("maps a plain string error code and the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, error: "SHARE_EXPIRED" }, 410)));
    const error = await deleteJson("/api/voyage/share?token=x").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "SHARE_EXPIRED", status: 410 });
    expect((error as ApiError).message).toContain("HTTP 410");
  });

  it("returns parsed JSON on success and sends no-store + accept headers", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return jsonResponse({ ok: true, configured: { LLM_API_KEY: true } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const body = await getJson<{ ok: boolean; configured: Record<string, boolean> }>("/api/voyage/local-credentials");
    expect(body.configured.LLM_API_KEY).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ cache: "no-store", method: "GET" });
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("rejects a 2xx HTML response instead of returning it as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>", { status: 200 })));
    await expect(getJson("/api/voyage/trips")).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "服务返回了非 JSON 响应",
    });
  });

  it("propagates AbortError untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }));
    await expect(getJson("/api/amap/poi", { signal: new AbortController().signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("envelope data helpers", () => {
  it("unwraps data on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, data: { sessionId: "planning_1" } })));
    await expect(postEnvelopeData<{ sessionId: string }>("/api/voyage/planning/session", {})).resolves.toEqual({ sessionId: "planning_1" });
    await expect(getEnvelopeData<{ sessionId: string }>("/api/voyage/planning/session/1")).resolves.toEqual({ sessionId: "planning_1" });
  });

  it("throws an ApiError carrying the envelope when ok is false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, error: { code: "INVALID_INPUT", message: "缺少城市" } }, 400)));
    await expect(postEnvelopeData("/api/voyage/planning/session", {})).rejects.toMatchObject({
      name: "ApiError",
      code: "INVALID_INPUT",
      message: "缺少城市",
    });
  });

  it("rejects a 2xx envelope without data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    await expect(getEnvelopeData("/api/voyage/planning/session/1")).rejects.toMatchObject({ name: "ApiError" });
  });
});
