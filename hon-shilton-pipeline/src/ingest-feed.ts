import { openDb } from './db.js';
import { fetchFeed, YNET_FEED_URL } from './rss.js';
import { runFeed, type FeedOptions } from './feed.js';
import { buildDeps } from './pipeline.js';
import { logReport, printSummary } from './report.js';
import { DEFAULT_DB } from './paths.js';
import { parseCli, firstUrl } from './cli-args.js';

const DEFAULT_DELAY_MS = 2_000;

type Values = ReturnType<typeof parseCli>['values'];

function readOptions(values: Values): FeedOptions {
  return {
    force: values.force ?? false,
    scrapeOnly: values['scrape-only'] ?? false,
    delayMs: values['delay-ms'] != null ? Number(values['delay-ms']) : DEFAULT_DELAY_MS,
    limit: values.limit != null ? Number(values.limit) : undefined,
    concurrency: values.concurrency != null ? Number(values.concurrency) : undefined,
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseCli();
  const dbPath = values.db ?? DEFAULT_DB;
  const feedUrl = firstUrl(positionals, YNET_FEED_URL);
  const useFixture = values.fixture ?? false;

  const db = openDb(dbPath);
  console.log(`DB: ${dbPath}`);
  if (useFixture) console.warn('⚠  FIXTURE extraction — synthetic data for plumbing only, NOT real Claude Code output.');

  const items = await fetchFeed(feedUrl);
  console.log(`feed: ${items.length} items from ${feedUrl}`);

  const reports = await runFeed(db, items, readOptions(values), buildDeps(useFixture), logReport);
  printSummary(reports);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
