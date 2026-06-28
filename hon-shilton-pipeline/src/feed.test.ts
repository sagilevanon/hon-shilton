import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArticleStatus } from './article-status.js';
import { openDb, cacheArticle, getGraph } from './db.js';
import { runFeed, summarize } from './feed.js';
import { IngestOutcome, type Extractor, type Fetcher, type FeedRef } from './pipeline.js';
import { sleep } from './sleep.js';

const okArticle: Fetcher = async (url) => ({
  status: ArticleStatus.Ok,
  article: { url, title: 'T', body: 'B', outlet: 'ynet' },
});
const noRelations: Extractor = async () => ({ entities: [{ canonical_name: 'פלוני', type: 'person' }], relations: [] });

describe('feed run', () => {
  it('skips cached, records premium without crashing, ingests fresh, never re-fetches cached', async () => {
    const db = openDb(':memory:');
    cacheArticle(db, { url: 'https://x/cached', title: 't', body: 'b', outlet: 'ynet' }, ArticleStatus.Ok);

    const fetched: string[] = [];
    const fetch: Fetcher = async (url) => {
      fetched.push(url);
      if (url === 'https://x/premium') return { status: ArticleStatus.PremiumSkipped, reason: 'locked' };
      return okArticle(url);
    };

    const items: FeedRef[] = [{ url: 'https://x/cached' }, { url: 'https://x/premium' }, { url: 'https://x/fresh' }];
    const reports = await runFeed(db, items, { delayMs: 0, concurrency: 1 }, { fetch, extract: noRelations });
    const counts = summarize(reports);

    assert.equal(counts[IngestOutcome.Cached], 1);
    assert.equal(counts[IngestOutcome.PremiumSkipped], 1);
    assert.equal(counts[IngestOutcome.Ingested], 1);
    assert.deepEqual(fetched, ['https://x/premium', 'https://x/fresh']);
  });

  it('isolates a failing extraction so the rest of the batch still runs', async () => {
    const db = openDb(':memory:');
    const exploding: Extractor = async (article) => {
      if (article.url === 'https://x/bad') throw new Error('claude timed out');
      return noRelations(article);
    };

    const items: FeedRef[] = [{ url: 'https://x/bad' }, { url: 'https://x/good' }];
    const reports = await runFeed(db, items, { delayMs: 0 }, { fetch: okArticle, extract: exploding });
    const counts = summarize(reports);

    assert.equal(counts[IngestOutcome.Error], 1);
    assert.equal(counts[IngestOutcome.Ingested], 1);
    assert.equal(reports.find((r) => r.url === 'https://x/bad')?.reason, 'claude timed out');
  });

  it('caps processing at limit', async () => {
    const db = openDb(':memory:');
    const items: FeedRef[] = [{ url: 'https://x/1' }, { url: 'https://x/2' }, { url: 'https://x/3' }];
    const reports = await runFeed(db, items, { delayMs: 0, limit: 2 }, { fetch: okArticle, extract: noRelations });
    assert.equal(reports.length, 2);
  });

  it('runs extractions concurrently up to the concurrency cap', async () => {
    const db = openDb(':memory:');
    let active = 0;
    let peak = 0;
    const counting: Extractor = async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(10);
      active--;
      return noRelations({ url: '', title: '', body: '', outlet: 'ynet' });
    };
    const items: FeedRef[] = Array.from({ length: 12 }, (_, i) => ({ url: `https://x/${i}` }));
    await runFeed(db, items, { delayMs: 0, concurrency: 4 }, { fetch: okArticle, extract: counting });
    assert.equal(peak, 4, 'extraction fans out to the concurrency cap');
  });

  it('reports preserve feed order even when extractions finish out of order', async () => {
    const db = openDb(':memory:');
    const jittery: Extractor = async (article) => {
      const n = Number(article.url.split('/').pop());
      await sleep((5 - n) * 4);
      return noRelations(article);
    };
    const items: FeedRef[] = Array.from({ length: 5 }, (_, i) => ({ url: `https://x/${i}` }));
    const reports = await runFeed(db, items, { delayMs: 0, concurrency: 5 }, { fetch: okArticle, extract: jittery });
    assert.deepEqual(reports.map((r) => r.url), items.map((i) => i.url));
  });

  it('keeps DB writes serial: concurrent articles resolve onto one shared entity, no duplicates', async () => {
    const db = openDb(':memory:');
    const sharedActor: Extractor = async (article) => ({
      entities: [
        { canonical_name: 'בנימין נתניהו', type: 'person', qid: 'Q42993' },
        { canonical_name: `ארגון ${article.url}`, type: 'organization' },
      ],
      relations: [
        {
          source: 'בנימין נתניהו',
          target: `ארגון ${article.url}`,
          relation: 'חבר ב',
          category: 'פוליטי',
          directed: true,
          confidence: 'high',
          quote: 'q',
        },
      ],
    });
    const items: FeedRef[] = Array.from({ length: 8 }, (_, i) => ({ url: `https://x/${i}` }));
    await runFeed(db, items, { delayMs: 0, concurrency: 8 }, { fetch: okArticle, extract: sharedActor });

    const graph = getGraph(db);
    const netanyahu = graph.nodes.filter((n) => n.name === 'בנימין נתניהו');
    assert.equal(netanyahu.length, 1, 'the shared actor resolves to exactly one node despite concurrent extraction');
    assert.equal(graph.nodes.length, 9, '1 shared actor + 8 distinct orgs');
    assert.equal(graph.edges.length, 8, 'one edge per article, no dupes');
  });
});
