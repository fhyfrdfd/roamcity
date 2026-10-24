/**
 * Trust-replan evaluation CLI.
 *
 * The evaluation itself lives in src/services/evaluation/trust-evaluation.ts so
 * the dev-only POST /api/voyage/evaluate endpoint runs the same code path.
 *
 * Usage:
 *   npm run eval:trust
 *   npm run eval:trust -- --limit 3 --verbose
 *   npm run eval:trust -- --only cq-001,bj-008
 *   npm run eval:trust -- --no-route-check --skip-baseline
 *
 * Output: benchmarks/eval/trust/report.json + report.md
 *         benchmarks/results/eval-trust.json (summary, matches other evals)
 */
import path from "node:path";

import { loadEnvConfig } from "@next/env";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
loadEnvConfig(ROOT);
// The packaged .env.local enables demo fixtures; an evaluation of factual
// accuracy is meaningless against fixtures, so force the real provider.
process.env.VOYAGE_DEMO_MODE = "false";

import { runTrustEvaluation } from "@/services/evaluation/trust-evaluation";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

runTrustEvaluation({
  rootDir: ROOT,
  only: readArg("--only")?.split(",").map((id) => id.trim()).filter(Boolean),
  limit: Number(readArg("--limit") ?? 0) || undefined,
  verbose: process.argv.includes("--verbose"),
  skipBaseline: process.argv.includes("--skip-baseline"),
  checkBaselineRoutes: !process.argv.includes("--no-route-check"),
  persist: true,
}).catch((error) => {
  console.error("TRUST EVAL FAILED:", error);
  process.exit(1);
});
