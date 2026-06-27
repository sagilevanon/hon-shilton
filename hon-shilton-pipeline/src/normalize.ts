// Surface-form normalization for entity names and relation labels, applied at
// the storeExtraction boundary so cross-article entity resolution and edge dedup
// key on a canonical form. Models vary the quote glyph (ASCII " ' vs Hebrew
// gershayim ״ geresh ׳) and whitespace for the same name/relation, which would
// otherwise fragment one node/edge into several. We normalize TO the Hebrew
// gershayim/geresh — the form the controlled vocabulary (taxonomy.ts) already
// uses (יו״ר של, ח״כ מטעם) — so output stays orthographically correct AND merges.

const GERSHAYIM = '״'; // ״
const GERESH = '׳'; // ׳

export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/["“”]/g, GERSHAYIM)
    .replace(/['‘’]/g, GERESH)
    .replace(/\s+/g, ' ')
    .trim();
}
