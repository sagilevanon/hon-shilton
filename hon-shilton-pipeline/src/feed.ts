import { ingestOne, IngestOutcome, type IngestDeps, type IngestOptions, type IngestReport, type FeedRef } from './pipeline.js';
import { sleep } from './sleep.js';
import { timed } from './debug/instrument.js';
import type { DB } from './db.js';

export interface FeedOptions extends IngestOptions {
  delayMs: number;
  limit?: number;
}

export type ReportListener = (report: IngestReport, index: number, total: number) => void;

export async function runFeed(
  db: DB,
  items: FeedRef[],
  opts: FeedOptions,
  deps: IngestDeps,
  onReport?: ReportListener,
): Promise<IngestReport[]> {
  const selected = opts.limit != null ? items.slice(0, opts.limit) : items;
  const reports: IngestReport[] = [];

  for (let i = 0; i < selected.length; i++) {
    const report = await ingestSafely(db, selected[i], opts, deps);
    reports.push(report);
    onReport?.(report, i, selected.length);
    if (hitNetwork(report) && i < selected.length - 1) await timed('sleep', () => sleep(opts.delayMs));
  }
  return reports;
}

async function ingestSafely(db: DB, ref: FeedRef, opts: FeedOptions, deps: IngestDeps): Promise<IngestReport> {
  try {
    return await ingestOne(db, ref, opts, deps);
  } catch (err) {
    return {
      url: ref.url,
      outcome: IngestOutcome.Error,
      entities: 0,
      relations: 0,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export type OutcomeCounts = Record<IngestOutcome, number>;

export function summarize(reports: IngestReport[]): OutcomeCounts {
  const counts = Object.fromEntries(Object.values(IngestOutcome).map((o) => [o, 0])) as OutcomeCounts;
  for (const report of reports) counts[report.outcome]++;
  return counts;
}

function hitNetwork(report: IngestReport): boolean {
  return report.outcome !== IngestOutcome.Cached;
}
