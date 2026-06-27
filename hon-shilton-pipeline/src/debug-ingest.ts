// Debug entry point: run the REAL ingestion path (same fetch + Claude extract as
// `ingest-feed`) with GRAPH_DEBUG_TIMING on, then print a per-sub-step timing
// table plus a breakdown of where each Claude call's wall-clock goes.
//
//   GRAPH_EXTRACT_MODEL=opus GRAPH_EXTRACT_EFFORT=high \
//     npm run debug-ingest -- --limit 6 --db /tmp/debug-graph.db
//
// Defaults: scratch DB, force re-extract (so cached items don't skip the Claude
// call and starve the sample set).

import { openDb } from './db.js';
import { fetchFeed, YNET_FEED_URL } from './rss.js';
import { runFeed, DEFAULT_CONCURRENCY, type FeedOptions } from './feed.js';
import { buildDeps } from './pipeline.js';
import { resolveModelConfig } from './claude.js';
import { logReport } from './report.js';
import { parseCli, firstUrl } from './cli-args.js';
import { TIMING_ENABLED, getSamples, getClaudeSamples, timed } from './debug/instrument.js';
import { printStepTable, printClaudeBreakdown } from './debug/report.js';

const DEFAULT_DEBUG_DB = '/tmp/hon-shilton-debug-graph.db';
const DEFAULT_DELAY_MS = 2_000;
const STEP_ORDER = ['feed_fetch', 'http_fetch', 'parse', 'db_cache', 'extract', 'db_store', 'sleep'];

async function main(): Promise<void> {
  if (!TIMING_ENABLED) {
    console.error('Set GRAPH_DEBUG_TIMING=1 to collect timings. Aborting.');
    process.exit(1);
  }

  const { values, positionals } = parseCli();
  const dbPath = values.db ?? DEFAULT_DEBUG_DB;
  const feedUrl = firstUrl(positionals, YNET_FEED_URL);
  const useFixture = values.fixture ?? false;

  const opts: FeedOptions = {
    force: values.force ?? true, // default true: re-extract so cached items don't skip Claude
    scrapeOnly: values['scrape-only'] ?? false,
    delayMs: values['delay-ms'] != null ? Number(values['delay-ms']) : DEFAULT_DELAY_MS,
    limit: values.limit != null ? Number(values.limit) : 6,
    concurrency: values.concurrency != null ? Number(values.concurrency) : undefined,
  };

  const db = openDb(dbPath);
  console.log(`DB: ${dbPath}`);
  const cfg = resolveModelConfig();
  console.log(`model=${cfg.model} effort=${cfg.effort} concurrency=${opts.concurrency ?? DEFAULT_CONCURRENCY}`);
  if (useFixture) console.warn('⚠  FIXTURE extraction — synthetic, NOT real Claude output.');

  const wallStart = performance.now();
  const items = await timed('feed_fetch', () => fetchFeed(feedUrl));
  console.log(`feed: ${items.length} items — processing up to ${opts.limit}\n`);

  await runFeed(db, items, opts, buildDeps(useFixture), logReport);
  const wallTotal = performance.now() - wallStart;

  printStepTable(getSamples(), STEP_ORDER, wallTotal);
  printClaudeBreakdown(getClaudeSamples());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
