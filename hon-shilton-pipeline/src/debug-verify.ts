// Debug entry point for the verification stage: run the REAL verify path (same
// per-edge sonnet Claude call as `npm run verify`) with GRAPH_DEBUG_TIMING on,
// then print the Claude-call breakdown for the 'verify' label.
//
//   GRAPH_EXTRACT_MODEL=sonnet \
//     npm run debug-verify -- --force --limit 10 --db /tmp/debug-graph.db

import { openDb } from './db.js';
import { runVerification, buildVerifyDeps, type VerifyOptions } from './verification.js';
import { parseCli } from './cli-args.js';
import { TIMING_ENABLED, getClaudeSamples, getSamples } from './debug/instrument.js';
import { printStepTable, printClaudeBreakdown } from './debug/report.js';

const DEFAULT_DEBUG_DB = '/tmp/hon-shilton-debug-graph.db';

async function main(): Promise<void> {
  if (!TIMING_ENABLED) {
    console.error('Set GRAPH_DEBUG_TIMING=1 to collect timings. Aborting.');
    process.exit(1);
  }

  const { values } = parseCli();
  const dbPath = values.db ?? DEFAULT_DEBUG_DB;
  const useFixture = values.fixture ?? false;

  const opts: VerifyOptions = {
    force: values.force ?? false,
    limit: values.limit != null ? Number(values.limit) : undefined,
  };

  const db = openDb(dbPath);
  console.log(`DB: ${dbPath}`);
  console.log(`model=${process.env.GRAPH_EXTRACT_MODEL ?? 'opus'} effort=${process.env.GRAPH_EXTRACT_EFFORT ?? '(default)'}`);
  if (useFixture) console.warn('⚠  FIXTURE verification — synthetic verdicts, NOT real Claude output.');

  const wallStart = performance.now();
  const report = await runVerification(db, opts, buildVerifyDeps(useFixture));
  const wallTotal = performance.now() - wallStart;
  console.log(`verified ${report.total} edges — supported: ${report.supported}, unsupported: ${report.unsupported}, errors: ${report.errors}`);

  printStepTable(getSamples(), [], wallTotal);
  printClaudeBreakdown(getClaudeSamples());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
