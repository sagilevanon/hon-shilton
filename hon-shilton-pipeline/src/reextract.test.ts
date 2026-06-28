import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArticleStatus } from './article-status.js';
import { openDb, cacheArticle, getGraph, getCachedArticles } from './db.js';
import { reExtract } from './reextract.js';
import { buildDeps, type Extractor } from './pipeline.js';

describe('re-extract from cached bodies', () => {
  it('reads only ok articles with a body', () => {
    const db = openDb(':memory:');
    cacheArticle(db, { url: 'http://ok', title: 't', body: 'real body', outlet: 'ynet' }, ArticleStatus.Ok);
    cacheArticle(db, { url: 'http://premium', title: 't', body: '', outlet: 'ynet' }, ArticleStatus.PremiumSkipped);
    cacheArticle(db, { url: 'http://empty', title: 't', body: '', outlet: 'ynet' }, ArticleStatus.Ok);

    const cached = getCachedArticles(db);
    assert.deepEqual(cached.map((a) => a.url), ['http://ok']);
  });

  it('rebuilds a candidate graph in a separate DB without touching the source', async () => {
    const src = openDb(':memory:');
    cacheArticle(src, { url: 'http://1', title: 'a', body: 'body 1', outlet: 'ynet' }, ArticleStatus.Ok);
    cacheArticle(src, { url: 'http://2', title: 'b', body: 'body 2', outlet: 'ynet' }, ArticleStatus.Ok);

    const dst = openDb(':memory:');
    const report = await reExtract(src, dst, buildDeps(true), { concurrency: 2 });

    assert.equal(report.articles, 2);
    assert.equal(report.errors, 0);
    assert.equal(report.entities, 2, 'report counts the deduped graph (2 nodes), not 4 per-article entities');
    assert.equal(report.relations, 1, 'and the one corroborated edge, not 2 per-article relations');

    const graph = getGraph(dst);
    // The fixture yields the same 2 entities + 1 edge for every article, so
    // entity resolution collapses them and the edge is corroborated by both.
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].value, 2, 'both cached articles corroborate the one edge');
    assert.equal(getGraph(src).nodes.length, 0, 'source DB is untouched');
  });

  it('isolates a failing extraction and still stores the rest', async () => {
    const src = openDb(':memory:');
    cacheArticle(src, { url: 'http://bad', title: 'a', body: 'b', outlet: 'ynet' }, ArticleStatus.Ok);
    cacheArticle(src, { url: 'http://good', title: 'a', body: 'b', outlet: 'ynet' }, ArticleStatus.Ok);

    const flaky: Extractor = async (a) => {
      if (a.url === 'http://bad') throw new Error('stalled');
      return { entities: [{ canonical_name: 'פלוני', type: 'person' }], relations: [] };
    };
    const dst = openDb(':memory:');
    const report = await reExtract(src, dst, { fetch: async () => ({ status: ArticleStatus.Ok }), extract: flaky });

    assert.equal(report.errors, 1);
    assert.equal(report.entities, 1);
  });
});
