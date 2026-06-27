import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertEntity, findOrCreateEdge, addSource, getEdgesToVerify } from './db.js';
import { runVerification, type VerifyDeps } from './verification.js';
import type { VerifyClaim, Verdict } from './verify.js';

// Stub batch verifier: a claim is unsupported when its quote denies the relation.
const denialAware: VerifyDeps = {
  verify: async (claims) => claims.map((c) => ({ supported: !c.quote.includes('הכחיש') })),
};

function edgeState(db: ReturnType<typeof openDb>, id: number) {
  const row = db.prepare('SELECT status, verification FROM edges WHERE id = ?').get(id) as {
    status: string;
    verification: string;
  };
  return { status: row.status, verification: row.verification };
}

describe('verification stage', () => {
  it('marks each edge, auto-rejects the unsupported one, and is idempotent', async () => {
    const db = openDb(':memory:');
    const a = upsertEntity(db, { canonical_name: 'בנימין נתניהו', type: 'person' });
    const b = upsertEntity(db, { canonical_name: 'חברת השקעות', type: 'organization' });
    const c = upsertEntity(db, { canonical_name: 'עמותת צדק', type: 'organization' });

    const good = findOrCreateEdge(db, { src: a, tgt: b, relation: 'בעלים של', category: 'כספים', directed: true, confidence: 'high' });
    addSource(db, good, { url: 'http://a', outlet: 'ynet', quote: 'נתניהו הוא בעל השליטה בחברת ההשקעות' });
    const bad = findOrCreateEdge(db, { src: a, tgt: c, relation: 'תרם ל', category: 'כספים', directed: true, confidence: 'high' });
    addSource(db, bad, { url: 'http://b', outlet: 'ynet', quote: 'נתניהו הכחיש כי תרם לעמותת צדק' });

    const report = await runVerification(db, {}, denialAware);
    assert.equal(report.total, 2);
    assert.equal(report.supported, 1);
    assert.equal(report.unsupported, 1, 'the denied relation is marked unsupported');

    assert.deepEqual(edgeState(db, good), { status: 'proposed', verification: 'supported' }, 'supported edge still awaits review');
    assert.deepEqual(edgeState(db, bad), { status: 'rejected', verification: 'unsupported' }, 'unsupported edge is auto-rejected');

    assert.equal(getEdgesToVerify(db, false).length, 0, 'every edge now carries a verdict');
    const rerun = await runVerification(db, {}, denialAware);
    assert.equal(rerun.total, 0, 're-running only touches unchecked edges');
  });

  it('auto-rejects an edge with no supporting quote without calling the verifier', async () => {
    const db = openDb(':memory:');
    const a = upsertEntity(db, { canonical_name: 'א', type: 'person' });
    const b = upsertEntity(db, { canonical_name: 'ב', type: 'organization' });
    const e = findOrCreateEdge(db, { src: a, tgt: b, relation: 'עובד ב', category: 'מקצועי', directed: true, confidence: 'low' });
    addSource(db, e, { url: 'http://a', outlet: 'ynet' }); // no quote

    let called = false;
    const report = await runVerification(db, {}, { verify: async (claims) => ((called = true), claims.map(() => ({ supported: true }))) });
    assert.equal(called, false, 'no quote means no model call');
    assert.equal(report.unsupported, 1);
    assert.equal(report.calls, 0);
    assert.deepEqual(edgeState(db, e), { status: 'rejected', verification: 'unsupported' });
  });

  it('batches one Claude call per article, not one per edge', async () => {
    const db = openDb(':memory:');
    const a = upsertEntity(db, { canonical_name: 'א', type: 'person' });
    const b = upsertEntity(db, { canonical_name: 'ב', type: 'organization' });
    const cc = upsertEntity(db, { canonical_name: 'ג', type: 'organization' });

    const batchSizes: number[] = [];
    const deps: VerifyDeps = {
      verify: async (claims) => {
        batchSizes.push(claims.length);
        return claims.map(() => ({ supported: true }));
      },
    };

    // Article 1 contributes three edges, article 2 contributes one.
    for (const tgt of [b, cc]) {
      const e = findOrCreateEdge(db, { src: a, tgt, relation: 'חבר ב', category: 'פוליטי', directed: true, confidence: 'high' });
      addSource(db, e, { url: 'http://article-1', outlet: 'ynet', quote: `q-${tgt}` });
    }
    const e3 = findOrCreateEdge(db, { src: b, tgt: cc, relation: 'שותף עסקי של', category: 'מקצועי', directed: false, confidence: 'high' });
    addSource(db, e3, { url: 'http://article-1', outlet: 'ynet', quote: 'q3' });
    const e4 = findOrCreateEdge(db, { src: a, tgt: cc, relation: 'תרם ל', category: 'כספים', directed: true, confidence: 'high' });
    addSource(db, e4, { url: 'http://article-2', outlet: 'ynet', quote: 'q4' });

    const report = await runVerification(db, {}, deps);
    assert.equal(report.total, 4);
    assert.equal(report.calls, 2, 'two articles → two calls (not four)');
    assert.deepEqual(batchSizes.sort(), [1, 3], 'one call of 3 edges + one call of 1 edge');
  });

  it('falls back to per-edge calls when the batch returns a misaligned verdict array', async () => {
    const db = openDb(':memory:');
    const a = upsertEntity(db, { canonical_name: 'א', type: 'person' });
    const b = upsertEntity(db, { canonical_name: 'ב', type: 'organization' });
    const cc = upsertEntity(db, { canonical_name: 'ג', type: 'organization' });

    const e1 = findOrCreateEdge(db, { src: a, tgt: b, relation: 'בעלים של', category: 'כספים', directed: true, confidence: 'high' });
    addSource(db, e1, { url: 'http://a', outlet: 'ynet', quote: 'keep' });
    const e2 = findOrCreateEdge(db, { src: a, tgt: cc, relation: 'תרם ל', category: 'כספים', directed: true, confidence: 'high' });
    addSource(db, e2, { url: 'http://a', outlet: 'ynet', quote: 'הכחיש' });

    const deps: VerifyDeps = {
      verify: async (claims: VerifyClaim[]): Promise<Verdict[]> => {
        if (claims.length > 1) return [{ supported: true }]; // wrong length → triggers fallback
        return claims.map((c) => ({ supported: !c.quote.includes('הכחיש') }));
      },
    };

    const report = await runVerification(db, {}, deps);
    assert.equal(report.supported, 1, 'fallback re-checks each edge individually');
    assert.equal(report.unsupported, 1);
    assert.deepEqual(edgeState(db, e1), { status: 'proposed', verification: 'supported' });
    assert.deepEqual(edgeState(db, e2), { status: 'rejected', verification: 'unsupported' });
  });

  it('isolates a per-edge verifier failure as an error without aborting the rest', async () => {
    const db = openDb(':memory:');
    const a = upsertEntity(db, { canonical_name: 'א', type: 'person' });
    const b = upsertEntity(db, { canonical_name: 'ב', type: 'organization' });
    const e = findOrCreateEdge(db, { src: a, tgt: b, relation: 'בעלים של', category: 'כספים', directed: true, confidence: 'high' });
    addSource(db, e, { url: 'http://a', outlet: 'ynet', quote: 'q' });

    const report = await runVerification(db, {}, { verify: async () => { throw new Error('overloaded'); } });
    assert.equal(report.errors, 1);
    assert.equal(report.supported, 0);
    assert.deepEqual(edgeState(db, e), { status: 'proposed', verification: 'unchecked' }, 'an errored edge keeps its unchecked state for a later retry');
  });
});
