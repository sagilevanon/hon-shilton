// The verification stage: a distinct, independently-runnable pass over
// already-extracted edges. For each unchecked edge it asks the verifier whether
// the supporting quote backs the relation, then writes the verdict. Unsupported
// edges are auto-rejected (status='rejected') so they never reach the human
// review queue — keeping the reviewer's load to the minimum.

import { Verification } from './verification-status.js';
import { EdgeStatus } from './edge-status.js';
import { getEdgesToVerify, setVerification, setEdgeStatus, type DB, type VerificationRow } from './db.js';
import { verifyClaim, verifyFixture, type Verifier } from './verify.js';

export interface VerifyDeps {
  verify: Verifier;
}

export function buildVerifyDeps(useFixture: boolean): VerifyDeps {
  return { verify: useFixture ? async (c) => verifyFixture(c) : verifyClaim };
}

export interface VerifyOptions {
  force?: boolean;
  limit?: number;
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
}

export type VerifyListener = (row: VerificationRow, result: VerifyResult, reason?: string) => void;

export async function runVerification(
  db: DB,
  opts: VerifyOptions,
  deps: VerifyDeps,
  onResult?: VerifyListener,
): Promise<VerifyReport> {
  const rows = getEdgesToVerify(db, opts.force ?? false, opts.limit);
  const report: VerifyReport = { total: rows.length, supported: 0, unsupported: 0, errors: 0 };

  for (const row of rows) {
    try {
      const verdict = row.quote
        ? await deps.verify({
            source: row.source,
            target: row.target,
            relation: row.relation,
            directed: !!row.directed,
            quote: row.quote,
          })
        : { supported: false, reason: 'no supporting quote' };

      if (verdict.supported) {
        setVerification(db, row.id, Verification.Supported);
        report.supported++;
        onResult?.(row, VerifyResult.Supported, verdict.reason);
      } else {
        // Auto-reject: an unsupported edge never reaches the human review queue.
        setVerification(db, row.id, Verification.Unsupported);
        setEdgeStatus(db, row.id, EdgeStatus.Rejected);
        report.unsupported++;
        onResult?.(row, VerifyResult.Unsupported, verdict.reason);
      }
    } catch (err) {
      report.errors++;
      onResult?.(row, VerifyResult.Error, err instanceof Error ? err.message : String(err));
    }
  }
  return report;
}
