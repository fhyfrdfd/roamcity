import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/services/evaluation/trust-evaluation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/evaluation/trust-evaluation")>();
  return { ...actual, runTrustEvaluation: vi.fn() };
});

import { POST } from "@/app/api/voyage/evaluate/route";
import { runTrustEvaluation } from "@/services/evaluation/trust-evaluation";

const task = {
  id: "cq-test",
  city: "重庆",
  prompt: "带父母在重庆玩两天，少走路",
  startDate: "2030-05-01",
  constraints: { days: 2, travelers: 3, budget: 3000, walkingTolerance: "low" as const },
  expect: { days: 2, minStopsPerDay: 3, mustHaveMeal: true, maxTravelMinutes: 60, noDuplicatePlace: true },
};

const report = { tasks: 1, cases: [] } as unknown as Awaited<ReturnType<typeof runTrustEvaluation>>;

let guest = 0;
function guestCookie() {
  guest += 1;
  const suffix = String(guest).padStart(12, "0");
  return `voyage_guest_workspace=00000000-0000-4000-8000-${suffix}`;
}

function post(body: unknown) {
  return new Request("http://local/api/voyage/evaluate", {
    method: "POST",
    headers: { cookie: guestCookie(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/voyage/evaluate", () => {
  it("runs a single-task evaluation with baseline when tasks are omitted", async () => {
    vi.mocked(runTrustEvaluation).mockResolvedValue(report);
    const response = await POST(post({}));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, report: { tasks: 1, cases: [] } });
    expect(vi.mocked(runTrustEvaluation)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, persist: false, quiet: true }),
    );
  });

  it("passes caller-supplied tasks through the same runner", async () => {
    vi.mocked(runTrustEvaluation).mockResolvedValue(report);
    const response = await POST(post({ tasks: [task], skipBaseline: true }));

    expect(response.status).toBe(200);
    expect(vi.mocked(runTrustEvaluation)).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: "cq-test" })],
        skipBaseline: true,
        persist: false,
      }),
    );
  });

  it("rejects malformed tasks before spending provider quota", async () => {
    const response = await POST(post({ tasks: [{ id: "" }] }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
    expect(vi.mocked(runTrustEvaluation)).not.toHaveBeenCalled();
  });

  it("surfaces runner failures as an error envelope", async () => {
    vi.mocked(runTrustEvaluation).mockRejectedValue(new Error("缺少 AMAP_SERVER_KEY"));
    const response = await POST(post({ tasks: [task] }));

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatchObject({ code: "EVALUATION_FAILED", message: "缺少 AMAP_SERVER_KEY" });
  });

  it("is disabled outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(post({}));
    vi.unstubAllEnvs();

    expect(response.status).toBe(403);
    expect(vi.mocked(runTrustEvaluation)).not.toHaveBeenCalled();
  });
});
