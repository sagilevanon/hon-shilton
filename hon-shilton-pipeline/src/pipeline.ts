import { ArticleStatus } from './article-status.js';
import { cacheArticle, isArticleCached, upsertEntity, findOrCreateEdge, addSource, type DB } from './db.js';
import { fetchArticle, type FetchResult } from './ynet.js';
import { extractWithClaude, extractFixture } from './extract.js';
import { categoryOf, SYMMETRIC_RELATIONS } from './taxonomy.js';
import { normalize } from './normalize.js';
import { timed } from './debug/instrument.js';
import type { ArticleInput, ExtractionResult, ExtractedEntity } from './types.js';

export enum IngestOutcome {
  Ingested = 'ingested',
  Cached = 'cached',
  PremiumSkipped = 'premium_skipped',
  ScrapeOnly = 'scrape_only',
  Irrelevant = 'irrelevant',
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

export type Prepared =
  | { kind: 'terminal'; report: IngestReport }
  | { kind: 'extract'; article: ArticleInput };

export async function prepareArticle(db: DB, ref: FeedRef, opts: IngestOptions, deps: IngestDeps): Promise<Prepared> {
  const empty = { url: ref.url, entities: 0, relations: 0 };

  if (!opts.force && isArticleCached(db, ref.url)) {
    return terminal({ ...empty, outcome: IngestOutcome.Cached });
  }

  const fetched = await deps.fetch(ref.url, { tags: ref.tags });
  if (fetched.status !== ArticleStatus.Ok || !fetched.article) {
    if (!isArticleCached(db, ref.url)) cacheArticle(db, emptyArticle(ref.url), fetched.status);
    return terminal({ ...empty, outcome: outcomeOf(fetched.status), reason: fetched.reason });
  }

  const article = fetched.article;
  await timed('db_cache', () => cacheArticle(db, article, ArticleStatus.Ok));
  if (opts.scrapeOnly) {
    return terminal({ ...empty, outcome: IngestOutcome.ScrapeOnly, title: article.title });
  }
  return { kind: 'extract', article };
}

export function extractArticle(deps: IngestDeps, article: ArticleInput): Promise<ExtractionResult> {
  return timed('extract', () => deps.extract(article));
}

export async function finalizeExtraction(db: DB, article: ArticleInput, result: ExtractionResult): Promise<IngestReport> {
  if (result.relevant === false) {
    return {
      url: article.url,
      outcome: IngestOutcome.Irrelevant,
      title: article.title,
      entities: 0,
      relations: 0,
      reason: rejectionReason(result),
    };
  }
  const relations = await timed('db_store', () => storeExtraction(db, article, result));
  return {
    url: article.url,
    outcome: IngestOutcome.Ingested,
    title: article.title,
    entities: result.entities.length,
    relations,
  };
}

export async function ingestOne(db: DB, ref: FeedRef, opts: IngestOptions, deps: IngestDeps): Promise<IngestReport> {
  const prepared = await prepareArticle(db, ref, opts, deps);
  if (prepared.kind === 'terminal') return prepared.report;
  const result = await extractArticle(deps, prepared.article);
  return finalizeExtraction(db, prepared.article, result);
}

function terminal(report: IngestReport): Prepared {
  return { kind: 'terminal', report };
}

function rejectionReason(result: ExtractionResult): string | undefined {
  return [result.topic, result.reason].map((s) => s?.trim()).filter(Boolean).join(' — ') || undefined;
}

export function storeExtraction(db: DB, article: ArticleInput, result: ExtractionResult): number {
  const idByName = new Map<string, number>();
  for (const entity of result.entities) {
    const normalized = normalizeEntity(entity);
    idByName.set(normalized.canonical_name, upsertEntity(db, normalized));
  }

  let stored = 0;
  for (const relation of result.relations) {
    const src = idByName.get(normalize(relation.source));
    const tgt = idByName.get(normalize(relation.target));
    if (src == null || tgt == null) continue;

    const rel = normalize(relation.relation);
    const directed = SYMMETRIC_RELATIONS.has(rel) ? false : relation.directed;
    const edgeId = findOrCreateEdge(db, {
      src,
      tgt,
      relation: rel,
      category: relation.category ?? categoryOf(rel),
      subcategory: relation.subcategory ? normalize(relation.subcategory) : relation.subcategory,
      raw_phrase: relation.raw_phrase ? normalize(relation.raw_phrase) : relation.raw_phrase,
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

function normalizeEntity(e: ExtractedEntity): ExtractedEntity {
  return { ...e, canonical_name: normalize(e.canonical_name), aliases: e.aliases?.map(normalize) };
}

function emptyArticle(url: string): ArticleInput {
  return { url, title: '', body: '', outlet: 'ynet' };
}

function outcomeOf(status: ArticleStatus): IngestOutcome {
  return status === ArticleStatus.PremiumSkipped ? IngestOutcome.PremiumSkipped : IngestOutcome.Error;
}
