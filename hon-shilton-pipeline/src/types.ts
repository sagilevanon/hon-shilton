import type { Category, Confidence } from './taxonomy.js';

// --- Input: one scraped article handed to the extractor ---
export interface ArticleInput {
  url: string;
  title: string;
  body: string;
  outlet: string; // e.g. 'ynet'
  publishedDate?: string; // ISO 8601
  author?: string;
  tags?: string[]; // RSS entity hints, passed to the extractor
}

export type EntityType = 'person' | 'organization';

// --- Output: what Claude Code is asked to return per article ---
export interface ExtractedEntity {
  canonical_name: string; // Hebrew canonical form
  type: EntityType;
  subtype?: string | null; // company | ngo | political_party | government_body | media_outlet
  aliases?: string[];
  qid?: string | null; // Wikidata QID when confident (e.g. "Q42993")
  description?: string | null; // one line
}

export interface ExtractedRelation {
  source: string; // canonical_name of the source entity
  target: string; // canonical_name of the target entity
  relation: string; // a RELATION_VOCAB term, or 'other'
  category: Category;
  subcategory?: string | null; // 1-4 word free-text label, required when category === 'אחר'
  raw_phrase?: string | null; // preserved phrasing, required when relation === 'other'
  directed: boolean;
  confidence: Confidence;
  quote: string; // the supporting sentence from the article body
}

export interface ExtractionResult {
  relevant?: boolean; // off-topic articles (sports, crime, …) are flagged false and stored as nothing
  topic?: string | null; // short label of the article's actual subject
  reason?: string | null; // one-line rejection rationale when relevant=false, for the run log
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

// --- Source attached to an edge (provenance) ---
export interface SourceInput {
  url: string;
  outlet: string;
  publishedDate?: string;
  quote?: string;
}
