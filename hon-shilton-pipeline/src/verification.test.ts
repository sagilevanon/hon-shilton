import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertEntity, findOrCreateEdge, addSource, getEdgesToVerify } from './db.js';
import { runVerification, type VerifyDeps } from './verification.js';

// Stub verifier: an edge is unsupported when its quote denies the relation.
const denialAware: VerifyDeps = {
  verify: async (claim) => ({ supported: !claim.quote.includes('הכחיש') }),
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
    const report = await runVerification(db, {}, { verify: async () => ((called = true), { supported: true }) });
    assert.equal(called, false, 'no quote means no model call');
    assert.equal(report.unsupported, 1);
    assert.deepEqual(edgeState(db, e), { status: 'rejected', verification: 'unsupported' });
  });
});
