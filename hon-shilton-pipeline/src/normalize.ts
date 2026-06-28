// Surface-form normalization for entity names and relation labels, applied at
// the storeExtraction boundary so cross-article entity resolution and edge dedup
// key on a canonical form. Models vary the quote glyph (ASCII " ' vs Hebrew
// gershayim ״ geresh ׳) and whitespace for the same name/relation, which would
// otherwise fragment one node/edge into several. We normalize TO the Hebrew
// gershayim/geresh — the form the controlled vocabulary (taxonomy.ts) already
// uses (יו״ר של, ח״כ מטעם) — so output stays orthographically correct AND merges.

const GERSHAYIM = '״'; // ״
const GERESH = '׳'; // ׳

// Only a quote glyph touching a Hebrew letter is the gershayim/geresh inside a
// Hebrew acronym (יו"ר, ח"כ); a quote between Latin letters is a real apostrophe
// (O'Brien, Moody's) and must be left alone, or the name renders wrong and stops
// matching its Wikidata alias.
const HE = 'א-ת';
const DQUOTE = new RegExp(`(?<=[${HE}])["“”]|["“”](?=[${HE}])`, 'g');
const SQUOTE = new RegExp(`(?<=[${HE}])['‘’]|['‘’](?=[${HE}])`, 'g');

export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(DQUOTE, GERSHAYIM)
    .replace(SQUOTE, GERESH)
    .replace(/\s+/g, ' ')
    .trim();
}
