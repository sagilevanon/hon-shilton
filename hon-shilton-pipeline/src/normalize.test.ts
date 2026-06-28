import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.js';
import { openDb, getGraph } from './db.js';
import { storeExtraction } from './pipeline.js';
import type { ArticleInput, ExtractionResult } from './types.js';

describe('normalize', () => {
  it('unifies ASCII quotes and Hebrew gershayim/geresh to one canonical form', () => {
    assert.equal(normalize('יו"ר של'), normalize('יו״ר של'));
    assert.equal(normalize('צה"ל'), 'צה״ל');
    assert.equal(normalize("ג'ורג'"), normalize('ג׳ורג׳'));
    assert.equal(normalize('מנכ"ל של'), 'מנכ״ל של');
  });

  it('collapses whitespace and trims, and is idempotent', () => {
    assert.equal(normalize('  בנימין   נתניהו '), 'בנימין נתניהו');
    const once = normalize('יו"ר   של');
    assert.equal(normalize(once), once);
  });

  it('leaves plain Hebrew and slashes untouched', () => {
    assert.equal(normalize('אח/אחות של'), 'אח/אחות של');
    assert.equal(normalize('בנימין נתניהו'), 'בנימין נתניהו');
  });
});

const article = (url: string): ArticleInput => ({ url, title: 't', body: 'b', outlet: 'ynet' });

describe('storeExtraction normalization', () => {
  it('merges glyph-variant entities and relations across articles onto one node/edge', () => {
    const db = openDb(':memory:');

    // Article 1: ASCII quote forms.
    const a1: ExtractionResult = {
      entities: [
        { canonical_name: 'אייל זמיר', type: 'person' },
        { canonical_name: 'צה"ל', type: 'organization' },
      ],
      relations: [
        { source: 'אייל זמיר', target: 'צה"ל', relation: 'יו"ר של', category: 'מקצועי', directed: true, confidence: 'high', quote: 'q1' },
      ],
    };
    // Article 2: same facts, Hebrew gershayim forms + extra whitespace.
    const a2: ExtractionResult = {
      entities: [
        { canonical_name: 'אייל זמיר', type: 'person' },
        { canonical_name: 'צה״ל', type: 'organization' },
      ],
      relations: [
        { source: 'אייל זמיר', target: 'צה״ל', relation: 'יו״ר  של', category: 'מקצועי', directed: true, confidence: 'high', quote: 'q2' },
      ],
    };

    storeExtraction(db, article('http://a1'), a1);
    storeExtraction(db, article('http://a2'), a2);

    const g = getGraph(db);
    assert.equal(g.nodes.length, 2, 'אייל זמיר + צה״ל — the two glyph spellings of צהל collapse to one node');
    assert.equal(g.edges.length, 1, 'the יו״ר של relation is one edge despite the quote-glyph difference');
    assert.equal(g.edges[0].value, 2, 'both articles corroborate the single edge');
    assert.equal(g.nodes.find((n) => n.type === 'organization')?.name, 'צה״ל', 'stored in canonical gershayim form');
  });
});
