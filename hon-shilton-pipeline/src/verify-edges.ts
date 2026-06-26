// Verification stage CLI:
//   npm run verify -- [--force] [--limit N] [--fixture] [--db PATH]
// Checks each extracted edge's quote against its relation and writes the verdict.
// Default: only unchecked edges. --force re-checks everything.

import { openDb } from './db.js';
import { runVerification, buildVerifyDeps, VerifyResult, type VerifyListener } from './verification.js';
import { arrow } from './verify.js';
import { DEFAULT_DB } from './paths.js';
import { parseCli } from './cli-args.js';

const logVerdict: VerifyListener = (row, result, reason) => {
  const why = reason ? `  · ${reason}` : '';
  console.log(`[${result}] ${row.source} ${arrow(!!row.directed)} ${row.target} (${row.relation})${why}`);
};

async function main(): Promise<void> {
  const { values } = parseCli();
  const dbPath = values.db ?? DEFAULT_DB;
  const useFixture = values.fixture ?? false;

  const db = openDb(dbPath);
  console.log(`DB: ${dbPath}`);
  if (useFixture) console.warn('⚠  FIXTURE verification — synthetic verdicts, NOT real Claude Code output.');

  const opts = { force: values.force ?? false, limit: values.limit != null ? Number(values.limit) : undefined };
  const report = await runVerification(db, opts, buildVerifyDeps(useFixture), logVerdict);
  if (report.total === 0) console.log('nothing to verify — all edges already checked.');
  console.log(
    `\ndone: ${report.total} edges — ${VerifyResult.Supported}: ${report.supported}, ` +
      `${VerifyResult.Unsupported}: ${report.unsupported}, errors: ${report.errors}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
