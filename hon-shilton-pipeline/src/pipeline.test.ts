import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertEntity, findOrCreateEdge, addSource, getGraph } from './db.js';
import { finalizeExtraction, IngestOutcome } from './pipeline.js';
import { parseArticle } from './ynet.js';
import type { ArticleInput } from './types.js';

describe('db round-trip', () => {
  it('dedups entities (qid + name), dedups edges, accumulates sources, serves display shape', () => {
    const db = openDb(':memory:');

    const a1 = upsertEntity(db, { canonical_name: 'בנימין נתניהו', type: 'person', qid: 'Q42993', aliases: ['ביבי'] });
    const a2 = upsertEntity(db, { canonical_name: 'ראש הממשלה', type: 'person', qid: 'Q42993' }); // same QID
    const b = upsertEntity(db, { canonical_name: 'הליכוד', type: 'organization', subtype: 'political_party' });
    assert.equal(a1, a2, 'same QID resolves to one entity');
    assert.notEqual(a1, b);

    const e1 = findOrCreateEdge(db, { src: a1, tgt: b, relation: 'חבר ב', category: 'פוליטי', directed: true, confidence: 'high' });
    const e2 = findOrCreateEdge(db, { src: a1, tgt: b, relation: 'חבר ב', category: 'פוליטי', directed: true, confidence: 'high' });
    assert.equal(e1, e2, 'same (src,tgt,relation) reuses the edge');

    addSource(db, e1, { url: 'http://a', outlet: 'ynet', quote: 'q1' });
    addSource(db, e1, { url: 'http://a', outlet: 'ynet', quote: 'dup' }); // same url -> ignored
    addSource(db, e1, { url: 'http://b', outlet: 'mako', quote: 'q2' }); // corroboration

    const g = getGraph(db);
    assert.equal(g.nodes.length, 2);
    assert.equal(g.edges.length, 1);
    assert.equal(g.edges[0].value, 2, 'corroboration = distinct sources');
    assert.equal(g.edges[0].sources.length, 2);
  });

  it('resolves an entity whose canonical name matches an existing alias', () => {
    const db = openDb(':memory:');
    const full = upsertEntity(db, { canonical_name: 'בנימין נתניהו', type: 'person', aliases: ['ביבי'] });
    const nick = upsertEntity(db, { canonical_name: 'ביבי', type: 'person' });
    assert.equal(nick, full, 'canonical name matching an alias resolves to the same entity');
    assert.equal(getGraph(db).nodes.length, 1);
  });

  it('corroborates a symmetric relation reported in opposite directions onto one edge', () => {
    const db = openDb(':memory:');
    const a = upsertEntity(db, { canonical_name: 'א', type: 'person' });
    const b = upsertEntity(db, { canonical_name: 'ב', type: 'person' });

    const fwd = findOrCreateEdge(db, { src: a, tgt: b, relation: 'שותף עסקי של', category: 'מקצועי', directed: false, confidence: 'high' });
    const rev = findOrCreateEdge(db, { src: b, tgt: a, relation: 'שותף עסקי של', category: 'מקצועי', directed: false, confidence: 'high' });
    assert.equal(fwd, rev, 'undirected edge collapses regardless of order');

    addSource(db, fwd, { url: 'http://a', outlet: 'ynet' });
    addSource(db, rev, { url: 'http://b', outlet: 'mako' });

    const g = getGraph(db);
    assert.equal(g.edges.length, 1, 'single symmetric edge');
    assert.equal(g.edges[0].value, 2, 'both directions corroborate the one edge');
  });
});

describe('relevance gate', () => {
  const article: ArticleInput = { url: 'http://x', title: 'כותרת', body: 'גוף', outlet: 'ynet' };

  it('stores nothing and reports off-topic when the article is flagged irrelevant', async () => {
    const db = openDb(':memory:');
    const report = await finalizeExtraction(db, article, {
      relevant: false,
      topic: 'ספורט',
      reason: 'דרבי כדורגל, ללא זיקה לאנשי ציבור או כספים',
      entities: [{ canonical_name: 'קבוצת כדורגל', type: 'organization' }],
      relations: [],
    });

    assert.equal(report.outcome, IngestOutcome.Irrelevant);
    assert.equal(report.entities, 0);
    assert.equal(report.relations, 0);
    assert.equal(report.title, 'כותרת', 'the title rides along so the log identifies the article');
    assert.equal(report.reason, 'ספורט — דרבי כדורגל, ללא זיקה לאנשי ציבור או כספים');

    const g = getGraph(db);
    assert.equal(g.nodes.length, 0, 'an irrelevant article adds nothing to the graph');
    assert.equal(g.edges.length, 0);
  });

  it('stores the graph when the article is relevant', async () => {
    const db = openDb(':memory:');
    const report = await finalizeExtraction(db, article, {
      relevant: true,
      topic: 'פוליטי',
      entities: [
        { canonical_name: 'בנימין נתניהו', type: 'person' },
        { canonical_name: 'הליכוד', type: 'organization' },
      ],
      relations: [
        { source: 'בנימין נתניהו', target: 'הליכוד', relation: 'חבר ב', category: 'פוליטי', directed: true, confidence: 'high', quote: 'q' },
      ],
    });

    assert.equal(report.outcome, IngestOutcome.Ingested);
    assert.equal(report.relations, 1);
    assert.equal(getGraph(db).edges.length, 1);
  });
});

describe('ynet JSON-LD parsing', () => {
  const wrap = (obj: object) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;

  it('extracts headline/articleBody from a NewsArticle', () => {
    const html = wrap({ '@type': 'NewsArticle', headline: 'כותרת', articleBody: 'גוף הכתבה כאן.', datePublished: '2026-05-31T18:31:29Z' });
    const r = parseArticle(html, 'http://x');
    assert.equal(r.status, 'ok');
    assert.equal(r.article?.title, 'כותרת');
    assert.match(r.article!.body, /גוף הכתבה/);
  });

  it('skips premium (isAccessibleForFree=false)', () => {
    const html = wrap({ '@type': 'NewsArticle', headline: 'h', articleBody: 'x', isAccessibleForFree: false });
    assert.equal(parseArticle(html, 'http://x').status, 'premium_skipped');
  });

  it('errors when there is no Article JSON-LD', () => {
    assert.equal(parseArticle('<html></html>', 'http://x').status, 'error');
  });

  it('finds the Article nested inside a @graph array', () => {
    const html = wrap({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'NewsArticle', headline: 'h2', articleBody: 'body2' }] });
    const r = parseArticle(html, 'http://x');
    assert.equal(r.status, 'ok');
    assert.equal(r.article?.title, 'h2');
  });
});
