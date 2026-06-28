import {
  prepareArticle,
  extractArticle,
  finalizeExtraction,
  IngestOutcome,
  type IngestDeps,
  type IngestOptions,
  type IngestReport,
  type Fetcher,
  type FeedRef,
} from './pipeline.js';
import { mapPool, Semaphore, DEFAULT_CONCURRENCY } from './pool.js';
import { sleep } from './sleep.js';
import { timed } from './debug/instrument.js';
import type { ArticleInput, ExtractionResult } from './types.js';
import type { DB } from './db.js';

export { DEFAULT_CONCURRENCY };
export const DEFAULT_FETCH_CONCURRENCY = 2;

export interface FeedOptions extends IngestOptions {
  delayMs: number;
  limit?: number;
  concurrency?: number;
}

export type ReportListener = (report: IngestReport, index: number, total: number) => void;

type WorkerResult = { report: IngestReport } | { article: ArticleInput; result: ExtractionResult };

export async function runFeed(
  db: DB,
  items: FeedRef[],
  opts: FeedOptions,
  deps: IngestDeps,
  onReport?: ReportListener,
): Promise<IngestReport[]> {
  const distinct = dedupeByUrl(items);
  const selected = opts.limit != null ? distinct.slice(0, opts.limit) : distinct;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const fetchSem = new Semaphore(Math.min(DEFAULT_FETCH_CONCURRENCY, concurrency));
  const politeDeps: IngestDeps = { ...deps, fetch: politeFetch(deps.fetch, fetchSem, opts.delayMs) };

  // prepare+extract fan out across the pool (any order); a single serial consumer
  // drains them in feed order — keeping cross-article entity resolution race-free
  // and reporting progress per item as soon as it is ready, not only at the end.
  const slots = selected.map(() => deferred<WorkerResult>());
  const producers = mapPool(selected, concurrency, async (ref, i) => {
    slots[i].resolve(await processItem(db, ref, opts, politeDeps));
  });

  const reports: IngestReport[] = [];
  for (let i = 0; i < selected.length; i++) {
    const report = await store(db, await slots[i].promise);
    reports.push(report);
    onReport?.(report, i, selected.length);
  }
  await producers;
  return reports;
}

function dedupeByUrl(items: FeedRef[]): FeedRef[] {
  const seen = new Set<string>();
  return items.filter((ref) => (seen.has(ref.url) ? false : (seen.add(ref.url), true)));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function processItem(db: DB, ref: FeedRef, opts: FeedOptions, deps: IngestDeps): Promise<WorkerResult> {
  try {
    const prepared = await prepareArticle(db, ref, opts, deps);
    if (prepared.kind === 'terminal') return { report: prepared.report };
    const result = await extractArticle(deps, prepared.article);
    return { article: prepared.article, result };
  } catch (err) {
    return { report: errorReport(ref.url, err) };
  }
}

async function store(db: DB, work: WorkerResult): Promise<IngestReport> {
  if ('report' in work) return work.report;
  try {
    return await finalizeExtraction(db, work.article, work.result);
  } catch (err) {
    return errorReport(work.article.url, err);
  }
}

function politeFetch(fetch: Fetcher, sem: Semaphore, delayMs: number): Fetcher {
  return (url, opts) =>
    sem.run(async () => {
      const result = await fetch(url, opts);
      if (delayMs > 0) await timed('sleep', () => sleep(delayMs));
      return result;
    });
}

function errorReport(url: string, err: unknown): IngestReport {
  return {
    url,
    outcome: IngestOutcome.Error,
    entities: 0,
    relations: 0,
    reason: err instanceof Error ? err.message : String(err),
  };
}

export type OutcomeCounts = Record<IngestOutcome, number>;

export function summarize(reports: IngestReport[]): OutcomeCounts {
  const counts = Object.fromEntries(Object.values(IngestOutcome).map((o) => [o, 0])) as OutcomeCounts;
  for (const report of reports) counts[report.outcome]++;
  return counts;
}
