import { BUILTIN_KNOWLEDGE } from "./builtin-knowledge";
import type { TravelKnowledgeMatch, TravelKnowledgeRecord } from "./types";

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[\s,，。；;、/|:_-]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function overlap(query: Set<string>, record: TravelKnowledgeRecord) {
  const body = tokenize([record.title, record.content, ...record.tags].join(" "));
  let hits = 0;
  query.forEach((token) => {
    if (body.has(token) || [...body].some((candidate) => candidate.includes(token) || token.includes(candidate))) hits += 1;
  });
  return hits / Math.max(1, query.size);
}

export function retrieveTravelKnowledge(input: {
  city: string;
  query: string;
  tags?: string[];
  limit?: number;
}): TravelKnowledgeMatch[] {
  const query = tokenize([input.query, ...(input.tags ?? [])].join(" "));
  const now = new Date();

  return BUILTIN_KNOWLEDGE
    .filter((record) => record.city === "*" || record.city === input.city)
    .filter((record) => !record.validFrom || new Date(record.validFrom) <= now)
    .filter((record) => !record.validTo || new Date(record.validTo) >= now)
    .map((record) => {
      const tagBoost = (input.tags ?? []).filter((tag) => record.tags.includes(tag)).length * 0.12;
      const cityBoost = record.city === input.city ? 0.10 : 0;
      const relevance = Math.min(1, overlap(query, record) * 0.75 + tagBoost + cityBoost + record.confidence * 0.10);
      return { ...record, relevance };
    })
    .filter((record) => record.relevance > 0.05)
    .sort((a, b) => b.relevance - a.relevance || b.confidence - a.confidence)
    .slice(0, input.limit ?? 8);
}
