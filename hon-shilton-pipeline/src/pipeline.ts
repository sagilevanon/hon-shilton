import { ArticleStatus } from './article-status.js';
import { cacheArticle, isArticleCached, upsertEntity, findOrCreateEdge, addSource, type DB } from './db.js';
import { fetchArticle, type FetchResult } from './ynet.js';
import { extractWithClaude, extractFixture } from './extract.js';
import { categoryOf, SYMMETRIC_RELATIONS } from './taxonomy.js';
import type { ArticleInput, ExtractionResult } from './types.js';

export enum IngestOutcome {
  Ingested = 'ingested',
  Cached = 'cached',
  PremiumSkipped = 'premium_skipped',
  ScrapeOnly = 'scrape_only',
  Error = 'error',
}

export interface FeedRef {
  url: string;
  tags?: string[];
}

export interface IngestOptions {
  force?: boolean;
  scrapeOnly?: boolean;
}

export type Fetcher = (url: string, opts?: { tags?: string[] }) => Promise<FetchResult>;
export type Extractor = (article: ArticleInput) => Promise<ExtractionResult>;

export interface IngestDeps {
  fetch: Fetcher;
  extract: Extractor;
}

export interface IngestReport {
  url: string;
  outcome: IngestOutcome;
  title?: string;
  entities: number;
  relations: number;
  reason?: string;
}

const fixtureExtractor: Extractor = async (article) => extractFixture(article);

export function buildDeps(useFixture: boolean): IngestDeps {
  return { fetch: fetchArticle, extract: useFixture ? fixtureExtractor : extractWithClaude };
}

export async function ingestOne(db: DB, ref: FeedRef, opts: IngestOptions, deps: IngestDeps): Promise<IngestReport> {
  const empty = { url: ref.url, entities: 0, relations: 0 };

  if (!opts.force && isArticleCached(db, ref.url)) {
    return { ...empty, outcome: IngestOutcome.Cached };
  }

  const fetched = await deps.fetch(ref.url, { tags: ref.tags });
  if (fetched.status !== ArticleStatus.Ok || !fetched.article) {
    if (!isArticleCached(db, ref.url)) cacheArticle(db, emptyArticle(ref.url), fetched.status);
    return { ...empty, outcome: outcomeOf(fetched.status), reason: fetched.reason };
  }

  const article = fetched.article;
  cacheArticle(db, article, ArticleStatus.Ok);
  if (opts.scrapeOnly) {
    return { ...empty, outcome: IngestOutcome.ScrapeOnly, title: article.title };
  }

  const result = await deps.extract(article);
  const relations = storeExtraction(db, article, result);
  return {
    url: ref.url,
    outcome: IngestOutcome.Ingested,
    title: article.title,
    entities: result.entities.length,
    relations,
  };
}

export function storeExtraction(db: DB, article: ArticleInput, result: ExtractionResult): number {
  const idByName = new Map<string, number>();
  for (const entity of result.entities) idByName.set(entity.canonical_name, upsertEntity(db, entity));

  let stored = 0;
  for (const relation of result.relations) {
    const src = idByName.get(relation.source);
    const tgt = idByName.get(relation.target);
    if (src == null || tgt == null) continue;

    const directed = SYMMETRIC_RELATIONS.has(relation.relation) ? false : relation.directed;
    const edgeId = findOrCreateEdge(db, {
      src,
      tgt,
      relation: relation.relation,
      category: relation.category ?? categoryOf(relation.relation),
      raw_phrase: relation.raw_phrase,
      directed,
      confidence: relation.confidence,
    });
    addSource(db, edgeId, {
      url: article.url,
      outlet: article.outlet,
      publishedDate: article.publishedDate,
      quote: relation.quote,
    });
    stored++;
  }
  return stored;
}

function emptyArticle(url: string): ArticleInput {
  return { url, title: '', body: '', outlet: 'ynet' };
}

function outcomeOf(status: ArticleStatus): IngestOutcome {
  return status === ArticleStatus.PremiumSkipped ? IngestOutcome.PremiumSkipped : IngestOutcome.Error;
}
