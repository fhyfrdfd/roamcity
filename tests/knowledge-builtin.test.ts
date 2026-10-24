// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BUILTIN_KNOWLEDGE } from "@/services/knowledge/builtin-knowledge";
import { buildBuiltinKnowledge } from "@/services/knowledge/builtin-source";
import { retrieveTravelKnowledge } from "@/services/knowledge/retriever";

describe("generated builtin knowledge", () => {
  it("matches the knowledge/** corpus exactly", async () => {
    const expected = await buildBuiltinKnowledge();
    // If this fails, run `npm run knowledge:build` and commit the regenerated file.
    expect(BUILTIN_KNOWLEDGE).toEqual(expected);
  });

  it("covers the promised city corpus and global transport rules", async () => {
    const records = await buildBuiltinKnowledge();
    for (const city of ["重庆", "成都", "西安", "杭州"]) {
      expect(records.filter((record) => record.city === city).length).toBeGreaterThanOrEqual(2);
    }
    const globalTags = new Set(records.filter((record) => record.city === "*").flatMap((record) => record.tags));
    expect(globalTags.has("rain")).toBe(true);
    expect(globalTags.has("luggage")).toBe(true);
    expect(globalTags.has("budget")).toBe(true);
  });

  it("is reachable from local retrieval", () => {
    const matches = retrieveTravelKnowledge({ city: "杭州", query: "西湖 步行 人流", tags: ["walking"], limit: 5 });
    expect(matches.some((match) => match.title.includes("西湖"))).toBe(true);
    const chengdu = retrieveTravelKnowledge({ city: "成都", query: "熊猫 基地 排队", tags: ["crowd"], limit: 5 });
    expect(chengdu.some((match) => match.title.includes("熊猫"))).toBe(true);
  });
});
