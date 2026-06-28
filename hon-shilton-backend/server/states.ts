// Sovereign-state entities act as super-hubs: nearly every diplomatic, security,
// or economic story links back to a country, so a handful of state nodes (USA,
// Israel, Iran, …) dominate the graph's connectivity and bury the relationships
// a reader actually came to trace. The explorer flags them so readers can toggle
// states off to cut that noise.
//
// "State" has no clean signal in the data: the entity type is just
// 'organization', the 'government_body' subtype is far too broad (it also tags
// the Knesset, the courts, the police, and individual army units), and some
// countries carry no subtype at all. So we match against a curated country list
// (countries.ts, generated from Wikidata — the full set of states, not just the
// ones in today's graph). Matched on Wikidata QID first (the stable key), with
// the canonical name as a fallback for any country the extractor left un-QID'd;
// both the curated names and the stored entity names share normalize.ts's
// canonical form, so the fallback compares like with like.

import { COUNTRIES } from './countries.js';

const STATE_QIDS = new Set(COUNTRIES.map((c) => c.qid));
const STATE_NAMES = new Set(COUNTRIES.flatMap((c) => c.names));

export function isStateEntity(qid: string | null | undefined, name: string): boolean {
  return (qid != null && STATE_QIDS.has(qid)) || STATE_NAMES.has(name);
}
