import { openDb } from './db.js';
import { buildDeps, ingestOne } from './pipeline.js';
import { logReport } from './report.js';
import { DEFAULT_DB } from './paths.js';
import { parseCli, firstUrl } from './cli-args.js';

const DEFAULT_URL = 'https://www.ynet.co.il/news/article/bk8pnl5emg';

async function main(): Promise<void> {
  const { values, positionals } = parseCli();
  const url = firstUrl(positionals, DEFAULT_URL);
  const dbPath = values.db ?? DEFAULT_DB;
  const useFixture = values.fixture ?? false;

  const db = openDb(dbPath);
  console.log(`DB: ${dbPath}`);
  if (useFixture) console.warn('⚠  FIXTURE extraction — synthetic data for plumbing only, NOT real Claude Code output.');

  const opts = { force: values.force ?? false, scrapeOnly: values['scrape-only'] ?? false };
  const report = await ingestOne(db, { url }, opts, buildDeps(useFixture));
  logReport(report);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
