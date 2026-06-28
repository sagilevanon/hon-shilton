// After-benchmark for the perf work. Runs the REAL orchestration (runFeed /
// runVerification) with a stub model call of a fixed latency, so it measures
// exactly what Phases A & B changed — concurrency + call granularity — with the
// model held constant. Then projects to real-world wall-clock using the measured
// per-call means from plans/ingestion-perf.md. No Claude calls, no network.
//
//   npm run bench -- [--limit ARTICLES]
//   tune the model held constant via env: BENCH_EDGES_PER, BENCH_EXTRACT_MS, BENCH_VERIFY_MS

import { openDb, upsertEntity, findOrCreateEdge, addSource, type DB } from './db.js';
import { runFeed } from './feed.js';
import { runVerification } from './verification.js';
import { ArticleStatus } from './article-status.js';
import { parseCli } from './cli-args.js';
import { sleep } from './sleep.js';
import type { Fetcher, Extractor, FeedRef } from './pipeline.js';
import type { BatchVerifier } from './verify.js';

const EXTRACT_MEAN_S = 115.6; // measured opus/high wall per extract call
const VERIFY_MEAN_S = 15.6; // measured sonnet wall per verify call

async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function benchExtract(articles: number, extractMs: number) {
  const okFetch: Fetcher = async (url) => ({ status: ArticleStatus.Ok, article: { url, title: 't', body: 'b', outlet: 'ynet' } });
  const slowExtract: Extractor = async () => {
    await sleep(extractMs);
    return { entities: [{ canonical_name: 'פלוני', type: 'person' }], relations: [] };
  };
  const items: FeedRef[] = Array.from({ length: articles }, (_, i) => ({ url: `https://x/${i}` }));
  return async (concurrency: number) => {
    const db = openDb(':memory:');
    return timeIt(() => runFeed(db, items, { delayMs: 0, concurrency }, { fetch: okFetch, extract: slowExtract }));
  };
}

function seedEdges(db: DB, count: number, urlOf: (i: number) => string): void {
  const actor = upsertEntity(db, { canonical_name: 'שחקן מרכזי', type: 'person' });
  for (let i = 0; i < count; i++) {
    const org = upsertEntity(db, { canonical_name: `ארגון ${i}`, type: 'organization' });
    const edge = findOrCreateEdge(db, { src: actor, tgt: org, relation: 'חבר ב', category: 'פוליטי', directed: true, confidence: 'high' });
    addSource(db, edge, { url: urlOf(i), outlet: 'ynet', quote: `ציטוט ${i}` });
  }
}

function benchVerify(edges: number, verifyMs: number) {
  const stub: BatchVerifier = async (claims) => {
    await sleep(verifyMs);
    return claims.map(() => ({ supported: true }));
  };
  return {
    perEdgeSerial: () => {
      const db = openDb(':memory:');
      seedEdges(db, edges, (i) => `https://article/${i}`); // unique url per edge → one call each
      return timeIt(() => runVerification(db, { concurrency: 1 }, { verify: stub }));
    },
    batched: (articles: number, concurrency: number) => {
      const db = openDb(':memory:');
      seedEdges(db, edges, (i) => `https://article/${i % articles}`); // edges grouped into `articles` calls
      return timeIt(() => runVerification(db, { concurrency }, { verify: stub }));
    },
  };
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const speedup = (base: number, now: number) => `×${(base / now).toFixed(1)}`;
const mins = (s: number) => `${(s / 60).toFixed(1)}min`;

async function main(): Promise<void> {
  const { values } = parseCli();
  const articles = values.limit != null ? Number(values.limit) : 8;
  const edgesPerArticle = Number(process.env.BENCH_EDGES_PER ?? 8);
  const extractMs = Number(process.env.BENCH_EXTRACT_MS ?? 300);
  const verifyMs = Number(process.env.BENCH_VERIFY_MS ?? 150);
  const totalEdges = articles * edgesPerArticle;

  console.log(`\nSIMULATED BENCH — real orchestration, stub model (extract=${extractMs}ms, verify=${verifyMs}ms/call)`);
  console.log(`batch: ${articles} articles, ${edgesPerArticle} edges/article (${totalEdges} edges)\n`);

  console.log('Phase A — extraction (runFeed):');
  const ext = benchExtract(articles, extractMs);
  const serial = await ext(1);
  console.log(`  serial   (conc=1):  ${fmt(serial)}`);
  for (const c of [5, 10]) {
    const w = await ext(c);
    console.log(`  pooled   (conc=${c}): ${fmt(w)}  ${speedup(serial, w)}`);
  }

  console.log('\nPhase B — verification (runVerification):');
  const ver = benchVerify(totalEdges, verifyMs);
  const perEdge = await ver.perEdgeSerial();
  console.log(`  per-edge serial (old): ${totalEdges} calls  ${fmt(perEdge)}`);
  for (const c of [1, 5]) {
    const w = await ver.batched(articles, c);
    console.log(`  batched (conc=${c}):     ${articles} calls  ${fmt(w)}  ${speedup(perEdge, w)}`);
  }

  console.log(`\nPROJECTED REAL-WORLD — measured means (extract ${EXTRACT_MEAN_S}s, verify ${VERIFY_MEAN_S}s per call):`);
  const exSerial = articles * EXTRACT_MEAN_S;
  const exPooled = Math.ceil(articles / 5) * EXTRACT_MEAN_S;
  const vSerial = totalEdges * VERIFY_MEAN_S;
  const vPooled = Math.ceil(articles / 5) * VERIFY_MEAN_S;
  console.log(`  extraction:  serial ${mins(exSerial)} → pooled(5) ${mins(exPooled)}  ${speedup(exSerial, exPooled)}`);
  console.log(`  verification: per-edge ${mins(vSerial)} → batched(5) ${mins(vPooled)}  ${speedup(vSerial, vPooled)}`);
  console.log(`  end-to-end:  before ${mins(exSerial + vSerial)} → after ${mins(exPooled + vPooled)}  ${speedup(exSerial + vSerial, exPooled + vPooled)}`);
  console.log('\n(Phase D additionally caps a stalled call at ~210s + one retry instead of a 360s burn.)\n');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
