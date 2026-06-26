import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArticleStatus } from './article-status.js';
import { openDb, cacheArticle } from './db.js';
import { runFeed, summarize } from './feed.js';
import { IngestOutcome, type Extractor, type Fetcher, type FeedRef } from './pipeline.js';

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
    const reports = await runFeed(db, items, { delayMs: 0 }, { fetch, extract: noRelations });
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
});
