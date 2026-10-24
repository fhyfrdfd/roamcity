import { discoverKnowledgeFiles, parseKnowledgeFile, repositoryKnowledgeRoot } from "./ingest";
import type { TravelKnowledgeRecord } from "./types";

/** Corpus revision timestamp used by the generated fallback records. */
export const CORPUS_UPDATED_AT = "2026-10-21T00:00:00.000Z";

/**
 * Builds the local retrieval fallback from the repository's markdown/JSON
 * corpus. `knowledge/**` is the single source of truth; the checked-in
 * `builtin-knowledge.ts` is generated from it by `npm run knowledge:build`.
 */
export async function buildBuiltinKnowledge(root = repositoryKnowledgeRoot()): Promise<TravelKnowledgeRecord[]> {
  const files = await discoverKnowledgeFiles(root);
  const documents = await Promise.all(files.map((file) => parseKnowledgeFile(file, root)));
  const records = documents.map((doc) => ({
    id: doc.sourceKey.replace(/\.(?:md|txt|json)$/i, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    kind: doc.kind,
    city: doc.city,
    title: doc.title,
    content: doc.content,
    tags: doc.tags,
    confidence: doc.confidence,
    source: doc.source,
    ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
    ...(doc.validFrom ? { validFrom: doc.validFrom } : {}),
    ...(doc.validTo ? { validTo: doc.validTo } : {}),
    updatedAt: CORPUS_UPDATED_AT,
    authorityLevel: doc.authorityLevel,
  } satisfies TravelKnowledgeRecord));
  const seen = new Set<string>();
  for (const record of records) {
    if (!record.id) throw new Error(`Knowledge file produced an empty id: ${record.title}`);
    if (seen.has(record.id)) throw new Error(`Duplicate knowledge id: ${record.id}`);
    seen.add(record.id);
  }
  return records.sort((left, right) => left.id.localeCompare(right.id));
}
