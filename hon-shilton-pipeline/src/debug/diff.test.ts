import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertEntity, findOrCreateEdge, addSource, getGraph } from '../db.js';
import { diffGraphs } from './diff.js';

// Build a graph DB from a compact spec so the diff can be checked end-to-end
// through the real getGraph shape (entity ids differ between the two DBs).
function build(
  entities: Array<{ name: string; type?: 'person' | 'organization'; qid?: string }>,
  edges: Array<{ s: string; t: string; rel: string; cat?: string; directed?: boolean; conf?: string; url?: string; quote?: string }>,
) {
  const db = openDb(':memory:');
  const ids = new Map<string, number>();
  for (const e of entities) ids.set(e.name, upsertEntity(db, { canonical_name: e.name, type: e.type ?? 'person', qid: e.qid }));
  for (const e of edges) {
    const id = findOrCreateEdge(db, {
      src: ids.get(e.s)!,
      tgt: ids.get(e.t)!,
      relation: e.rel,
      category: e.cat ?? 'פוליטי',
      directed: e.directed ?? true,
      confidence: e.conf ?? 'high',
    });
    addSource(db, id, { url: e.url ?? 'http://a', outlet: 'ynet', quote: e.quote });
  }
  return getGraph(db);
}

describe('diffGraphs', () => {
  it('reports entity add/drop/common keyed by qid then name (ids differ across DBs)', () => {
    const base = build([{ name: 'נתניהו', qid: 'Q1' }, { name: 'גנץ', qid: 'Q2' }], []);
    const cand = build([{ name: 'בנימין נתניהו', qid: 'Q1' }, { name: 'לפיד', qid: 'Q3' }], []);
    const d = diffGraphs(base, cand);
    assert.equal(d.entities.common, 1, 'Q1 is shared even though the canonical name changed');
    assert.deepEqual(d.entities.onlyBase, ['גנץ']);
    assert.deepEqual(d.entities.onlyCandidate, ['לפיד']);
  });

  it('keys edges by name pair + relation, attaching url + quote to divergences', () => {
    const base = build(
      [{ name: 'א' }, { name: 'ב' }, { name: 'ג' }],
      [
        { s: 'א', t: 'ב', rel: 'חבר ב', url: 'http://1', quote: 'q1' },
        { s: 'א', t: 'ג', rel: 'תרם ל', url: 'http://2', quote: 'q2' },
      ],
    );
    const cand = build(
      [{ name: 'א' }, { name: 'ב' }, { name: 'ד' }],
      [
        { s: 'א', t: 'ב', rel: 'חבר ב' },
        { s: 'א', t: 'ד', rel: 'תרם ל', url: 'http://3', quote: 'q3' },
      ],
    );
    const d = diffGraphs(base, cand);
    assert.equal(d.edges.common, 1, 'א→ב [חבר ב] is common');
    assert.equal(d.edges.dropped.length, 1);
    assert.equal(d.edges.dropped[0].target, 'ג');
    assert.equal(d.edges.dropped[0].quote, 'q2', 'dropped edge carries its baseline source quote');
    assert.equal(d.edges.added.length, 1);
    assert.equal(d.edges.added[0].target, 'ד');
    assert.equal(d.edges.added[0].url, 'http://3');
  });

  it('matches an undirected edge regardless of endpoint order', () => {
    const base = build([{ name: 'א' }, { name: 'ב' }], [{ s: 'א', t: 'ב', rel: 'שותף', directed: false }]);
    const cand = build([{ name: 'א' }, { name: 'ב' }], [{ s: 'ב', t: 'א', rel: 'שותף', directed: false }]);
    const d = diffGraphs(base, cand);
    assert.equal(d.edges.common, 1);
    assert.equal(d.edges.dropped.length, 0);
    assert.equal(d.edges.added.length, 0);
  });

  it('flags an attribute change on a common edge', () => {
    const base = build([{ name: 'א' }, { name: 'ב' }], [{ s: 'א', t: 'ב', rel: 'חבר ב', conf: 'high' }]);
    const cand = build([{ name: 'א' }, { name: 'ב' }], [{ s: 'א', t: 'ב', rel: 'חבר ב', conf: 'low' }]);
    const d = diffGraphs(base, cand);
    assert.equal(d.edges.changed.length, 1);
    assert.deepEqual(
      { field: d.edges.changed[0].field, base: d.edges.changed[0].base, candidate: d.edges.changed[0].candidate },
      { field: 'confidence', base: 'high', candidate: 'low' },
    );
  });
});
