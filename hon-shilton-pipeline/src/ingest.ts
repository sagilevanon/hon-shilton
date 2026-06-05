// Phase 1 ingest CLI: scrape ONE ynet article -> (extract) -> write SQLite.
//
//   npm run ingest -- [URL] [--db PATH] [--fixture] [--scrape-only] [--force]
//
//   URL           article to ingest (default: a known free ynet article)
//   --fixture     use the synthetic extractor (no Claude Code call)
//   --scrape-only fetch + cache the article, skip extraction
//   --force       refetch even if the article is already cached
//   --db PATH     SQLite file (default: ../hon-shilton-backend/server/graph.db)

import path from 'node:path';
import { openDb, cacheArticle, isArticleCached, upsertEntity, findOrCreateEdge, addSource, type DB } from './db.js';
import { fetchArticle } from './ynet.js';
import { extractWithClaude, extractFixture } from './extract.js';
import { categoryOf, SYMMETRIC_RELATIONS } from './taxonomy.js';
import type { ArticleInput, ExtractionResult } from './types.js';

const DEFAULT_URL = 'https://www.ynet.co.il/news/article/bk8pnl5emg';
const DEFAULT_DB = process.env.GRAPH_DB_PATH ?? path.resolve(import.meta.dirname, '../../hon-shilton-backend/server/graph.db');

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.argv.slice(2).find((a) => a.startsWith('http')) ?? DEFAULT_URL;
  const dbPath = opt('--db') ?? DEFAULT_DB;
  const db = openDb(dbPath);
  console.log(`DB: ${dbPath}`);

  if (!flag('--force') && isArticleCached(db, url)) {
    console.log(`already cached (use --force to refetch): ${url}`);
  }

  const fr = await fetchArticle(url);
  if (fr.status !== 'ok' || !fr.article) {
    cacheArticle(db, { url, title: '', body: '', outlet: 'ynet' }, fr.status === 'premium_skipped' ? 'premium_skipped' : 'error');
    console.log(`article ${fr.status}${fr.reason ? `: ${fr.reason}` : ''}`);
    return;
  }
  const article = fr.article;
  cacheArticle(db, article, 'ok');
  console.log(`scraped: "${article.title}" — ${article.body.length} chars, published ${article.publishedDate ?? '?'}`);

  if (flag('--scrape-only')) {
    console.log('scrape-only: done.');
    return;
  }

  let result: ExtractionResult;
  if (flag('--fixture')) {
    console.warn('⚠  FIXTURE extraction — synthetic data for plumbing only, NOT real Claude Code output.');
    result = extractFixture(article);
  } else {
    result = await extractWithClaude(article);
  }

  store(db, article, result);
}

function store(db: DB, article: ArticleInput, result: ExtractionResult): void {
  const idByName = new Map<string, number>();
  for (const e of result.entities) idByName.set(e.canonical_name, upsertEntity(db, e));

  let stored = 0;
  for (const r of result.relations) {
    const src = idByName.get(r.source);
    const tgt = idByName.get(r.target);
    if (src == null || tgt == null) {
      console.warn(`skip relation (unknown entity): ${r.source} -[${r.relation}]-> ${r.target}`);
      continue;
    }
    const directed = SYMMETRIC_RELATIONS.has(r.relation) ? false : r.directed;
    const category = r.category ?? categoryOf(r.relation);
    const edgeId = findOrCreateEdge(db, {
      src,
      tgt,
      relation: r.relation,
      category,
      raw_phrase: r.raw_phrase,
      directed,
      confidence: r.confidence,
    });
    addSource(db, edgeId, { url: article.url, outlet: article.outlet, publishedDate: article.publishedDate, quote: r.quote });
    stored++;
  }
  console.log(`stored: ${result.entities.length} entities, ${stored} relations`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
