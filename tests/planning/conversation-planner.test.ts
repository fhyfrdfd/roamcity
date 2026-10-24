// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({
  getLlmConfig: vi.fn(),
  chatJson: vi.fn(),
}));

vi.mock("@/services/ai/llm", () => llm);

import {
  extractPlanningProfile,
  mergePlanningProfiles,
  planConversationTurn,
} from "@/services/planning/conversation-planner";

describe("conversation planner", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VOYAGE_LLM_ENABLED", "1");
    llm.getLlmConfig.mockReset();
    llm.chatJson.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("extracts only stated profile facts from a natural-language turn", () => {
    const patch = extractPlanningProfile("从桂林去南京玩 3 天，2 个人，预算 3000 元，喜欢美食，少走路，夫子庙必去");
    expect(patch).toMatchObject({
      origin: "桂林",
      destination: "南京",
      days: 3,
      travelers: 2,
      budget: 3000,
      walkingTolerance: "low",
    });
    expect(patch.vibes).toContain("美食");
    expect(patch.mustVisit).toContain("夫子庙");
    expect(patch).not.toHaveProperty("startDate");
  });

  it("extracts the golden-trip landing prompt exactly as typed by the user", () => {
    const patch = extractPlanningProfile("从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路");
    expect(patch.origin).toBe("桂林");
    expect(patch.destination).toBe("重庆");
    expect(patch.days).toBe(3);
    expect(patch.travelers).toBe(2);
    expect(patch.budget).toBe(2500);
    expect(patch.walkingTolerance).toBe("low");
    expect(patch.vibes).toEqual(expect.arrayContaining(["美食", "夜景"]));
  });

  it("treats a flexible budget answer as complete instead of asking for a number again", async () => {
    llm.getLlmConfig.mockReturnValue(null);
    const result = await planConversationTurn({
      profile: { destination: "南京", startDate: "2030-05-01", days: 3, travelers: 1 },
      message: "预算比较灵活",
    });
    expect(result.profile.budgetMode).toBe("flexible");
    expect(result.missing).not.toContain("budget");
    expect(result.ready).toBe(true);
    expect(result.question).not.toContain("预算");
  });

  it("continues collecting optional preferences after required facts are complete", async () => {
    llm.getLlmConfig.mockReturnValue(null);
    const result = await planConversationTurn({
      profile: {
        destination: "南京",
        startDate: "2030-05-01",
        days: 3,
        travelers: 1,
        budget: 3000,
        pace: "balanced",
        walkingTolerance: "medium",
      },
      message: "可以生成路线了",
    });
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.question).toContain("最想体验什么");
    expect(result.assistantMessage.content).toContain(result.question);
  });

  it("asks for walking tolerance and interests one at a time", async () => {
    llm.getLlmConfig.mockReturnValue(null);
    const base = {
      destination: "南京",
      startDate: "2030-05-01",
      days: 3,
      travelers: 1,
      budget: 3000,
      pace: "balanced" as const,
    };
    const walking = await planConversationTurn({ profile: base, message: "安排充实一点" });
    expect(walking.ready).toBe(true);
    expect(walking.question).toBe("你对步行的接受程度怎么样：少走、适中，还是可以多走？");

    const interests = await planConversationTurn({
      profile: { ...base, walkingTolerance: "medium" },
      message: "步行适中就好",
    });
    expect(interests.ready).toBe(true);
    expect(interests.question).toContain("最想体验什么");
  });

  it("does not repeat a satisfied core question or claim the route was generated", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test" });
    llm.chatJson.mockResolvedValue({
      profilePatch: {},
      assistantMessage: "预算还需要再确认一下。路线已为你生成。",
      question: "预算是多少？",
      ready: false,
    });
    const result = await planConversationTurn({
      profile: {
        destination: "南京",
        startDate: "2030-05-01",
        days: 3,
        travelers: 1,
        budget: 3000,
      },
      message: "预算比较灵活",
    });
    expect(result.ready).toBe(true);
    expect(result.question).not.toContain("预算");
    expect(result.assistantMessage.content).not.toContain("预算");
    expect(result.assistantMessage.content).not.toContain("路线已为你生成");
  });

  it("merges list facts while letting the current explicit scalar facts win", () => {
    const profile = mergePlanningProfiles(
      { destination: "南京", vibes: ["美食"], mustVisit: ["夫子庙"] },
      { destination: "苏州", vibes: ["园林", "美食"], avoid: ["爬山"] },
    );
    expect(profile.destination).toBe("苏州");
    expect(profile.vibes).toEqual(["美食", "园林"]);
    expect(profile.mustVisit).toEqual(["夫子庙"]);
    expect(profile.avoid).toEqual(["爬山"]);
  });

  it("reports unavailable LLM state and asks one deterministic high-value question", async () => {
    llm.getLlmConfig.mockReturnValue(null);
    const result = await planConversationTurn({
      profile: {},
      message: "想去南京玩 3 天",
    });
    expect(result.source).toBe("rules");
    expect(result.llm).toBe("unavailable");
    expect(result.fallbackReason).toBe("LLM_BASE_URL 未配置");
    expect(result.question).toBe("你计划什么时候出发，或者准备玩几天？");
    expect((result.question?.match(/[?？]/g) ?? [])).toHaveLength(1);
    expect(llm.chatJson).not.toHaveBeenCalled();
  });

  it("falls back safely when the model response fails schema validation", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test" });
    llm.chatJson.mockResolvedValue({ profilePatch: { destination: "模型虚构城市" } });
    const result = await planConversationTurn({
      profile: { destination: "南京", startDate: "2030-05-01", days: 3, travelers: 2, budget: 3000 },
      message: "轻松一点",
    });
    expect(result.source).toBe("rules");
    expect(result.llm).toBe("failed");
    expect(result.profile.destination).toBe("南京");
    expect(result.profile.pace).toBe("relaxed");
    expect(result.fallbackReason).toContain("schema validation");
  });

  it("uses a schema-valid model patch but preserves explicit user facts", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test" });
    llm.chatJson.mockResolvedValue({
      profilePatch: { pace: "packed", walkingTolerance: "high" },
      assistantMessage: "我已经按你的偏好更新了画像。",
      question: null,
      ready: true,
    });
    const result = await planConversationTurn({
      profile: { destination: "南京", startDate: "2030-05-01", days: 3, travelers: 2, budget: 3000 },
      message: "轻松一点，少走路",
    });
    expect(result.source).toBe("llm");
    expect(result.llm).toBe("used");
    expect(result.profile.pace).toBe("relaxed");
    expect(result.profile.walkingTolerance).toBe("low");
    expect(result.ready).toBe(true);
    expect(result.question).toBeNull();
  });
});
