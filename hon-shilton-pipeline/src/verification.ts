// The verification stage: a distinct, independently-runnable pass over
// already-extracted edges. Edges are grouped by the article their supporting
// quote came from and fact-checked one article per Claude call (returning a
// verdict per edge). On a misaligned/failed batch it falls back to per-edge
// calls so one bad batch never loses a whole article. Unsupported edges are
// auto-rejected (status='rejected') so they never reach the human review queue.

import { Verification } from './verification-status.js';
import { EdgeStatus } from './edge-status.js';
import { getEdgesToVerify, setVerification, setEdgeStatus, type DB, type VerificationRow } from './db.js';
import { verifyClaims, verifyClaimsFixture, type BatchVerifier, type VerifyClaim, type Verdict } from './verify.js';
import { mapPool, DEFAULT_CONCURRENCY } from './pool.js';

export interface VerifyDeps {
  verify: BatchVerifier;
}

export function buildVerifyDeps(useFixture: boolean): VerifyDeps {
  return { verify: useFixture ? async (claims) => verifyClaimsFixture(claims) : verifyClaims };
}

export interface VerifyOptions {
  force?: boolean;
  limit?: number;
  concurrency?: number;
}

export enum VerifyResult {
  Supported = 'supported',
  Unsupported = 'unsupported',
  Error = 'error',
}

export interface VerifyReport {
  total: number;
  supported: number;
  unsupported: number;
  errors: number;
  calls: number;
}

export type VerifyListener = (row: VerificationRow, result: VerifyResult, reason?: string) => void;

type RowOutcome = { row: VerificationRow; verdict: Verdict } | { row: VerificationRow; error: string };

const NO_QUOTE: Verdict = { supported: false, reason: 'no supporting quote' };

export async function runVerification(
  db: DB,
  opts: VerifyOptions,
  deps: VerifyDeps,
  onResult?: VerifyListener,
): Promise<VerifyReport> {
  const rows = getEdgesToVerify(db, opts.force ?? false, opts.limit);
  const report: VerifyReport = { total: rows.length, supported: 0, unsupported: 0, errors: 0, calls: 0 };

  const noQuote = rows.filter((r) => !r.quote);
  const groups = [...Map.groupBy(rows.filter((r) => r.quote), (r) => r.url ?? '')].map(([, g]) => g);

  const counter = { calls: 0 };
  const grouped = await mapPool(groups, opts.concurrency ?? DEFAULT_CONCURRENCY, (group) =>
    verifyGroup(group, deps, counter),
  );

  const outcomes = [...noQuote.map((row) => ({ row, verdict: NO_QUOTE })), ...grouped.flat()].sort(
    (a, b) => a.row.id - b.row.id,
  );

  report.calls = counter.calls;
  for (const o of outcomes) apply(db, o, report, onResult);
  return report;
}

async function verifyGroup(group: VerificationRow[], deps: VerifyDeps, counter: { calls: number }): Promise<RowOutcome[]> {
  const claims = group.map(toClaim);
  try {
    counter.calls++;
    const verdicts = await deps.verify(claims);
    if (verdicts.length === group.length) {
      return group.map((row, i) => ({ row, verdict: verdicts[i] }));
    }
  } catch {
    // fall through to the per-edge retry below
  }
  return perEdge(group, deps, counter);
}

async function perEdge(group: VerificationRow[], deps: VerifyDeps, counter: { calls: number }): Promise<RowOutcome[]> {
  return Promise.all(
    group.map(async (row) => {
      try {
        counter.calls++;
        const [verdict] = await deps.verify([toClaim(row)]);
        return verdict ? { row, verdict } : { row, error: 'verifier returned no verdict' };
      } catch (err) {
        return { row, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

function apply(db: DB, o: RowOutcome, report: VerifyReport, onResult?: VerifyListener): void {
  if ('error' in o) {
    report.errors++;
    onResult?.(o.row, VerifyResult.Error, o.error);
    return;
  }
  if (o.verdict.supported) {
    setVerification(db, o.row.id, Verification.Supported);
    report.supported++;
    onResult?.(o.row, VerifyResult.Supported, o.verdict.reason);
  } else {
    setVerification(db, o.row.id, Verification.Unsupported);
    setEdgeStatus(db, o.row.id, EdgeStatus.Rejected);
    report.unsupported++;
    onResult?.(o.row, VerifyResult.Unsupported, o.verdict.reason);
  }
}

function toClaim(row: VerificationRow): VerifyClaim {
  return {
    source: row.source,
    target: row.target,
    relation: row.relation,
    directed: !!row.directed,
    quote: row.quote ?? '',
  };
}
