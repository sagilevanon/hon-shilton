import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookupGazetteer, canonicalizeEntity } from './gazetteer.js';
import { openDb, getGraph, type DB } from './db.js';
import { storeExtraction } from './pipeline.js';
import type { ArticleInput, ExtractedEntity, ExtractionResult } from './types.js';

describe('gazetteer lookup', () => {
  it('resolves acronym, full-name, and definite-article variants to the canonical name + QID', () => {
    assert.deepEqual(lookupGazetteer('צבא ההגנה לישראל'), { canonical_name: 'צה״ל', qid: 'Q172353' });
    assert.deepEqual(lookupGazetteer('צה"ל'), { canonical_name: 'צה״ל', qid: 'Q172353' });
    assert.deepEqual(lookupGazetteer('כנסת'), { canonical_name: 'הכנסת', qid: 'Q207137' });
    assert.deepEqual(lookupGazetteer('הכנסת'), { canonical_name: 'הכנסת', qid: 'Q207137' });
    assert.deepEqual(lookupGazetteer('סנטקום')?.canonical_name, 'פיקוד המרכז של ארצות הברית');
    assert.deepEqual(lookupGazetteer('מח"ש')?.canonical_name, 'המחלקה לחקירות שוטרים');
  });

  it('leaves unknown names unmatched', () => {
    assert.equal(lookupGazetteer('בנימין נתניהו'), undefined);
    assert.equal(lookupGazetteer('אגודת ישראל'), undefined);
  });
});

describe('canonicalizeEntity', () => {
  it('rewrites a variant to canonical + QID and keeps the original spelling as an alias', () => {
    const out = canonicalizeEntity({ canonical_name: 'כנסת', type: 'organization' });
    assert.equal(out.canonical_name, 'הכנסת');
    assert.equal(out.qid, 'Q207137');
    assert.deepEqual(out.aliases, ['כנסת']);
  });

  it('backfills only a missing QID when the name is already canonical', () => {
    const out = canonicalizeEntity({ canonical_name: 'הכנסת', type: 'organization' });
    assert.equal(out.canonical_name, 'הכנסת');
    assert.equal(out.qid, 'Q207137');
    assert.equal(out.aliases, undefined);
  });

  it('never overwrites a QID the model already supplied', () => {
    const out = canonicalizeEntity({ canonical_name: 'צבא ההגנה לישראל', type: 'organization', qid: 'Q999' });
    assert.equal(out.canonical_name, 'צה״ל');
    assert.equal(out.qid, 'Q999');
  });

  it('passes unknown entities through untouched', () => {
    const e: ExtractedEntity = { canonical_name: 'בנימין נתניהו', type: 'person' };
    assert.equal(canonicalizeEntity(e), e);
  });
});

const article = (url: string): ArticleInput => ({ url, title: 't', body: 'b', outlet: 'ynet' });

function aliasesOf(db: DB, name: string): string[] {
  return (
    db
      .prepare(
        `SELECT a.alias FROM aliases a JOIN entities e ON e.id = a.entity_id
         WHERE e.canonical_name = ? ORDER BY a.alias`,
      )
      .all(name) as { alias: string }[]
  ).map((r) => r.alias);
}

describe('storeExtraction gazetteer merging', () => {
  it('collapses definite-article variants (כנסת/הכנסת) across articles onto one corroborated edge', () => {
    const db = openDb(':memory:');

    const a1: ExtractionResult = {
      entities: [
        { canonical_name: 'יריב לוין', type: 'person' },
        { canonical_name: 'הכנסת', type: 'organization' },
      ],
      relations: [
        { source: 'יריב לוין', target: 'הכנסת', relation: 'חבר ב', category: 'פוליטי', directed: true, confidence: 'high', quote: 'q1' },
      ],
    };
    const a2: ExtractionResult = {
      entities: [
        { canonical_name: 'יריב לוין', type: 'person' },
        { canonical_name: 'כנסת', type: 'organization' },
      ],
      relations: [
        { source: 'יריב לוין', target: 'כנסת', relation: 'חבר ב', category: 'פוליטי', directed: true, confidence: 'high', quote: 'q2' },
      ],
    };

    storeExtraction(db, article('http://a1'), a1);
    storeExtraction(db, article('http://a2'), a2);

    const g = getGraph(db);
    assert.equal(g.nodes.length, 2, 'יריב לוין + הכנסת — כנסת folds onto הכנסת');
    assert.equal(g.edges.length, 1, 'one חבר ב edge despite the definite-article spelling split');
    assert.equal(g.edges[0].value, 2, 'both articles corroborate the single edge');
    const knesset = g.nodes.find((n) => n.type === 'organization');
    assert.equal(knesset?.name, 'הכנסת', 'stored under the canonical name');
    assert.equal(knesset?.qid, 'Q207137', 'gazetteer backfilled the Wikidata QID');
    assert.deepEqual(aliasesOf(db, 'הכנסת'), ['כנסת'], 'the variant spelling survives as a searchable alias');
  });

  it('collapses acronym↔full-name (צה״ל/צבא ההגנה לישראל), composing Layer 1 glyph + Layer 2 synonym', () => {
    const db = openDb(':memory:');

    const a1: ExtractionResult = {
      entities: [
        { canonical_name: 'אייל זמיר', type: 'person' },
        { canonical_name: 'צה"ל', type: 'organization' },
      ],
      relations: [
        { source: 'אייל זמיר', target: 'צה"ל', relation: 'רמטכ״ל של', category: 'מקצועי', directed: true, confidence: 'high', quote: 'q1' },
      ],
    };
    const a2: ExtractionResult = {
      entities: [
        { canonical_name: 'אייל זמיר', type: 'person' },
        { canonical_name: 'צבא ההגנה לישראל', type: 'organization' },
      ],
      relations: [
        { source: 'אייל זמיר', target: 'צבא ההגנה לישראל', relation: 'רמטכ״ל של', category: 'מקצועי', directed: true, confidence: 'high', quote: 'q2' },
      ],
    };

    storeExtraction(db, article('http://a1'), a1);
    storeExtraction(db, article('http://a2'), a2);

    const g = getGraph(db);
    assert.equal(g.nodes.length, 2, 'אייל זמיר + צה״ל — the acronym and full name are one node');
    assert.equal(g.edges.length, 1, 'one רמטכ״ל של edge across the two spellings');
    assert.equal(g.edges[0].value, 2, 'both articles corroborate the single edge');
    const idf = g.nodes.find((n) => n.type === 'organization');
    assert.equal(idf?.name, 'צה״ל', 'stored under the canonical acronym (gershayim form)');
    assert.equal(idf?.qid, 'Q172353');
    assert.deepEqual(aliasesOf(db, 'צה״ל'), ['צבא ההגנה לישראל'], 'full name kept as alias');
  });
});
