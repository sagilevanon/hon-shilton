// Layer 2 normalization: a curated, high-precision gazetteer of the highest-
// frequency Israeli entities that the extractor splits across spellings, merging
// each synonym class onto one canonical node so cross-article corroboration holds.
// It covers what Layer 1 (normalize.ts, quote-glyph + whitespace only) cannot:
// definite-article variants (כנסת/הכנסת), acronym↔full-name (צה״ל/צבא ההגנה לישראל,
// מח״ש/המחלקה לחקירות שוטרים, סנטקום/פיקוד המרכז), and alternate phrasings
// (הצבא הלבנוני/צבא לבנון). Variants are seeded from the live model-divergence
// dumps (see plans/ingestion-perf.md). QIDs are attached only where verified in
// the production graph: a backfilled QID lets the existing QID-merge in db.ts
// collapse occurrences the model tagged inconsistently, but name-canonicalization
// alone already merges the rest, so an omitted QID is safe. Matching is glyph-
// insensitive (keys and inputs run through normalize) so Layer 1 and 2 compose.

import { normalize } from './normalize.js';
import type { ExtractedEntity } from './types.js';

export interface GazetteerEntry {
  canonical_name: string;
  qid?: string;
  variants: string[];
}

export interface GazetteerMatch {
  canonical_name: string;
  qid?: string;
}

export const GAZETTEER: readonly GazetteerEntry[] = [
  { canonical_name: 'צה״ל', qid: 'Q172353', variants: ['צבא ההגנה לישראל', 'צבא הגנה לישראל', 'צבא ההגנה', 'צבא הגנה'] },
  { canonical_name: 'הכנסת', qid: 'Q207137', variants: ['כנסת'] },
  { canonical_name: 'הליכוד', variants: ['ליכוד'] },
  { canonical_name: 'בית המשפט העליון', variants: ['בג״ץ', 'בית המשפט הגבוה לצדק', 'בית המשפט העליון של ישראל'] },
  { canonical_name: 'המחלקה לחקירות שוטרים', variants: ['מח״ש'] },
  { canonical_name: 'הצי האמריקני', qid: 'Q11220', variants: ['הצי האמריקאי', 'הצי של ארצות הברית'] },
  { canonical_name: 'הצי החמישי', variants: ['הצי החמישי של ארצות הברית'] },
  {
    canonical_name: 'פיקוד המרכז של ארצות הברית',
    variants: ['פיקוד המרכז של ארה״ב', 'פיקוד המרכז של צבא ארצות הברית', 'סנטקום'],
  },
  { canonical_name: 'הקונגרס האמריקני', qid: 'Q11268', variants: ['הקונגרס של ארצות הברית', 'קונגרס ארצות הברית', 'הקונגרס'] },
  { canonical_name: 'ארצות הברית', qid: 'Q30', variants: ['ארה״ב', 'אמריקה'] },
  { canonical_name: 'המפלגה הרפובליקנית', qid: 'Q29468', variants: ['המפלגה הריפובליקנית', 'הרפובליקנים'] },
  { canonical_name: 'צבא לבנון', variants: ['הצבא הלבנוני'] },
  { canonical_name: 'מועצת שיתוף הפעולה של מדינות המפרץ', qid: 'Q124964', variants: ['מועצת שיתוף הפעולה של המפרץ'] },
  { canonical_name: 'חטיבת גולני', variants: ['גולני'] },
  { canonical_name: 'דגל התורה', variants: ['דגל תורה', 'מפלגת דגל תורה', 'מפלגת דגל התורה'] },
  { canonical_name: 'נצח יהודה', variants: ['גדוד נצח יהודה'] },
  { canonical_name: 'הוול סטריט ג׳ורנל', qid: 'Q11149', variants: ['וול סטריט ג׳ורנל'] },
  { canonical_name: 'הניו יורק טיימס', qid: 'Q9684', variants: ['ניו יורק טיימס'] },
  { canonical_name: 'משמרות המהפכה', variants: ['משמרות המהפכה האסלאמית'] },
  { canonical_name: 'איחוד האמירויות הערביות', qid: 'Q878', variants: ['איחוד האמירויות'] },
  { canonical_name: 'משרד החוץ', variants: ['משרד החוץ הישראלי'] },
];

function buildIndex(): Map<string, GazetteerMatch> {
  const index = new Map<string, GazetteerMatch>();
  for (const entry of GAZETTEER) {
    const match: GazetteerMatch = { canonical_name: normalize(entry.canonical_name), qid: entry.qid };
    for (const name of [entry.canonical_name, ...entry.variants]) {
      const key = normalize(name);
      if (index.has(key)) throw new Error(`gazetteer: duplicate variant "${key}"`);
      index.set(key, match);
    }
  }
  return index;
}

const INDEX = buildIndex();

export function lookupGazetteer(name: string): GazetteerMatch | undefined {
  return INDEX.get(normalize(name));
}

export function canonicalizeEntity(e: ExtractedEntity): ExtractedEntity {
  const match = lookupGazetteer(e.canonical_name);
  if (!match) return e;
  if (match.canonical_name === normalize(e.canonical_name)) {
    return e.qid || !match.qid ? e : { ...e, qid: match.qid };
  }
  const aliases = [...new Set([...(e.aliases ?? []), e.canonical_name])];
  return { ...e, canonical_name: match.canonical_name, qid: e.qid ?? match.qid, aliases };
}
