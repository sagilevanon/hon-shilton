// Phase-C re-extraction CLI: rebuild a candidate graph from already-cached
// article bodies into a scratch DB — no re-fetch — so the model/effort is the
// only variable. Set GRAPH_EXTRACT_MODEL / GRAPH_EXTRACT_EFFORT to the candidate
// config, then diff the result against the baseline with `npm run debug-diff`.
//
//   GRAPH_EXTRACT_MODEL=sonnet npm run re-extract -- \
//     --from ../hon-shilton-backend/server/graph.db --db /tmp/cand-sonnet.db

import { openDb } from './db.js';
import { reExtract } from './reextract.js';
import { buildDeps } from './pipeline.js';
import { resolveModelConfig } from './claude.js';
import { parseCli } from './cli-args.js';

async function main(): Promise<void> {
  const { values } = parseCli();
  if (!values.from || !values.db) {
    console.error('Usage: npm run re-extract -- --from <source.db> --db <scratch.db> [--limit N] [--concurrency N] [--fixture]');
    process.exit(1);
  }
  const useFixture = values.fixture ?? false;
  const src = openDb(values.from);
  const dst = openDb(values.db);

  console.log(`re-extract: ${values.from} → ${values.db}`);
  const cfg = resolveModelConfig();
  console.log(`model=${cfg.model} effort=${cfg.effort}`);
  if (useFixture) console.warn('⚠  FIXTURE extraction — synthetic, NOT real Claude output.');

  const report = await reExtract(src, dst, buildDeps(useFixture), {
    concurrency: values.concurrency != null ? Number(values.concurrency) : undefined,
    limit: values.limit != null ? Number(values.limit) : undefined,
  });
  console.log(
    `done: ${report.articles} articles → ${report.entities} entities, ${report.relations} relations (${report.errors} errors)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
