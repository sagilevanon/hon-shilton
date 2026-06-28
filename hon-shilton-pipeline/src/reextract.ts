// Re-extract over already-cached article bodies into a scratch DB — no re-fetch.
// Isolates the model/effort as the only variable so a candidate config's graph
// can be diffed against the existing records (see debug/diff.ts). Reuses the
// production extract + store stages and the Phase-A concurrency pool.

import { extractArticle, finalizeExtraction, type IngestDeps } from './pipeline.js';
import { getCachedArticles, getGraph, type DB } from './db.js';
import { mapPool, DEFAULT_CONCURRENCY } from './pool.js';
import type { ArticleInput, ExtractionResult } from './types.js';

export interface ReExtractOptions {
  concurrency?: number;
  limit?: number;
}

export interface ReExtractReport {
  articles: number;
  entities: number;
  relations: number;
  errors: number;
}

type Outcome = { article: ArticleInput; result: ExtractionResult } | { article: ArticleInput; error: string };

export async function reExtract(src: DB, dst: DB, deps: IngestDeps, opts: ReExtractOptions = {}): Promise<ReExtractReport> {
  const articles = getCachedArticles(src, opts.limit);
  const outcomes = await mapPool(articles, opts.concurrency ?? DEFAULT_CONCURRENCY, (a) => extractOne(deps, a));

  const report: ReExtractReport = { articles: articles.length, entities: 0, relations: 0, errors: 0 };
  for (const o of outcomes) {
    if ('error' in o) {
      report.errors++;
      continue;
    }
    await finalizeExtraction(dst, o.article, o.result);
  }

  // Count the distinct persisted graph, not the per-article extracted totals:
  // entity resolution and edge dedup collapse entities/edges recurring across
  // articles, so summing per-article counts would overstate the candidate size —
  // the very metric the Phase-C eval compares.
  const graph = getGraph(dst);
  report.entities = graph.nodes.length;
  report.relations = graph.edges.length;
  return report;
}

async function extractOne(deps: IngestDeps, article: ArticleInput): Promise<Outcome> {
  try {
    return { article, result: await extractArticle(deps, article) };
  } catch (err) {
    return { article, error: err instanceof Error ? err.message : String(err) };
  }
}
