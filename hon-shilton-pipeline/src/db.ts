// SQLite access for the pipeline (writes) and a read helper for verification.
// Wrapped behind this module so the storage engine (node:sqlite today) can be
// swapped for better-sqlite3 / a cloud libSQL later without touching callers.

import {DatabaseSync} from 'node:sqlite';
import {ArticleStatus} from './article-status.js';
import {Verification} from './verification-status.js';
import {EdgeStatus} from './edge-status.js';
import type {ArticleInput, ExtractedEntity, SourceInput} from './types.js';

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  qid           TEXT UNIQUE,
  canonical_name TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('person','organization')),
  subtype       TEXT,
  description   TEXT,
  image         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);

CREATE TABLE IF NOT EXISTS aliases (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  UNIQUE (entity_id, alias)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias);

CREATE TABLE IF NOT EXISTS edges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  src_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  tgt_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation      TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('משפחה','כספים','מקצועי','פוליטי','משפטי','אחר')),
  raw_phrase    TEXT,
  directed      INTEGER NOT NULL DEFAULT 1,
  confidence    TEXT NOT NULL CHECK (confidence IN ('low','med','high')),
  status        TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  verification  TEXT NOT NULL DEFAULT 'unchecked' CHECK (verification IN ('unchecked','supported','unsupported')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (src_entity_id, tgt_entity_id, relation)
) STRICT;

CREATE TABLE IF NOT EXISTS edge_sources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_id        INTEGER NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  outlet         TEXT NOT NULL,
  published_date TEXT,
  quote          TEXT,
  UNIQUE (edge_id, url)
) STRICT;

CREATE TABLE IF NOT EXISTS articles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  url            TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  published_date TEXT,
  author         TEXT,
  outlet         TEXT,
  raw_body       TEXT,
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  status         TEXT NOT NULL CHECK (status IN ('ok','premium_skipped','error'))
) STRICT;
`;

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  // WAL so the backend can keep reading the served graph while ingestion writes;
  // busy_timeout absorbs the brief lock contention between the two processes.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function cacheArticle(db: DB, a: ArticleInput, status: ArticleStatus): void {
  db.prepare(
    `INSERT INTO articles (url, title, published_date, author, outlet, raw_body, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       title=excluded.title, published_date=excluded.published_date, author=excluded.author,
       outlet=excluded.outlet, raw_body=excluded.raw_body, status=excluded.status,
       fetched_at=datetime('now')`,
  ).run(a.url, a.title ?? null, a.publishedDate ?? null, a.author ?? null, a.outlet, a.body ?? null, status);
}

export function isArticleCached(db: DB, url: string): boolean {
  const row = db.prepare('SELECT url FROM articles WHERE url = ? AND status = ?').get(url, ArticleStatus.Ok);
  return !!row;
}

function resolveEntity(db: DB, e: ExtractedEntity): {id: number} | undefined {
  if (e.qid) {
    const byQid = db.prepare('SELECT id FROM entities WHERE qid = ?').get(e.qid) as {id: number} | undefined;
    if (byQid) return byQid;
  }
  const byName = db.prepare('SELECT id FROM entities WHERE canonical_name = ?').get(e.canonical_name) as
    | {id: number}
    | undefined;
  if (byName) return byName;

  const byAlias = db
    .prepare('SELECT entity_id AS id FROM aliases WHERE alias = ? LIMIT 2')
    .all(e.canonical_name) as {id: number}[];
  return byAlias.length === 1 ? byAlias[0] : undefined;
}

// Resolve an entity QID-first, canonical-name-second, alias-third (only when the
// alias maps to a single entity); insert if new; merge aliases. This is what keeps
// one real person on one node as it recurs across articles.
export function upsertEntity(db: DB, e: ExtractedEntity): number {
  const row = resolveEntity(db, e);

  let id: number;
  if (row) {
    id = Number(row.id);
    // Backfill QID / description if newly learned.
    if (e.qid) db.prepare('UPDATE entities SET qid = COALESCE(qid, ?) WHERE id = ?').run(e.qid, id);
    if (e.description) {
      db.prepare('UPDATE entities SET description = COALESCE(description, ?) WHERE id = ?').run(e.description, id);
    }
  } else {
    const res = db
      .prepare('INSERT INTO entities (qid, canonical_name, type, subtype, description) VALUES (?, ?, ?, ?, ?)')
      .run(e.qid ?? null, e.canonical_name, e.type, e.subtype ?? null, e.description ?? null);
    id = Number(res.lastInsertRowid);
  }

  const addAlias = db.prepare('INSERT OR IGNORE INTO aliases (entity_id, alias) VALUES (?, ?)');
  for (const a of e.aliases ?? []) {
    if (a && a !== e.canonical_name) addAlias.run(id, a);
  }
  return id;
}

export interface EdgeInput {
  src: number;
  tgt: number;
  relation: string;
  category: string;
  raw_phrase?: string | null;
  directed: boolean;
  confidence: string;
}

// Find-or-create the edge keyed on (src, tgt, relation), so a repeated relation
// from another article reuses the row and just gains a source (corroboration).
// Undirected (symmetric) edges are normalized to (min, max) so the same pair
// reported in either direction collapses onto one row.
export function findOrCreateEdge(db: DB, p: EdgeInput): number {
  const [src, tgt] = p.directed ? [p.src, p.tgt] : [Math.min(p.src, p.tgt), Math.max(p.src, p.tgt)];

  const existing = db
    .prepare('SELECT id FROM edges WHERE src_entity_id = ? AND tgt_entity_id = ? AND relation = ?')
    .get(src, tgt, p.relation) as {id: number} | undefined;
  if (existing) return Number(existing.id);

  const res = db
    .prepare(
      `INSERT INTO edges (src_entity_id, tgt_entity_id, relation, category, raw_phrase, directed, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(src, tgt, p.relation, p.category, p.raw_phrase ?? null, p.directed ? 1 : 0, p.confidence);
  return Number(res.lastInsertRowid);
}

export function addSource(db: DB, edgeId: number, s: SourceInput): void {
  db.prepare(
    `INSERT OR IGNORE INTO edge_sources (edge_id, url, outlet, published_date, quote)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(edgeId, s.url, s.outlet, s.publishedDate ?? null, s.quote ?? null);
}

export interface VerificationRow {
  id: number;
  source: string;
  target: string;
  relation: string;
  directed: number;
  quote: string | null;
  url: string | null;
}

// Edges awaiting a verification verdict, with their entity names and one
// representative supporting quote + the article it came from (so the verify
// stage can batch all of one article's edges into a single call). By default
// only 'unchecked' edges (so the stage is idempotent / resumable); `force`
// re-checks every edge.
export function getEdgesToVerify(db: DB, force: boolean, limit?: number): VerificationRow[] {
  const params: (string | number)[] = [];
  let where = '';
  if (!force) {
    where = 'WHERE e.verification = ?';
    params.push(Verification.Unchecked);
  }
  let lim = '';
  if (limit != null) {
    lim = ' LIMIT ?';
    params.push(Number(limit));
  }
  return db
    .prepare(
      `SELECT e.id, e.relation, e.directed,
              src.canonical_name AS source, tgt.canonical_name AS target,
              rep.quote AS quote, rep.url AS url
       FROM edges e
       JOIN entities src ON src.id = e.src_entity_id
       JOIN entities tgt ON tgt.id = e.tgt_entity_id
       LEFT JOIN edge_sources rep ON rep.id = (
         SELECT s.id FROM edge_sources s
         WHERE s.edge_id = e.id AND s.quote IS NOT NULL AND s.quote != ''
         ORDER BY s.id LIMIT 1
       )
       ${where}
       ORDER BY e.id${lim}`,
    )
    .all(...params) as unknown as VerificationRow[];
}

export function setVerification(db: DB, edgeId: number, v: Verification): void {
  db.prepare('UPDATE edges SET verification = ? WHERE id = ?').run(v, edgeId);
}

export function setEdgeStatus(db: DB, edgeId: number, status: EdgeStatus): void {
  db.prepare('UPDATE edges SET status = ? WHERE id = ?').run(status, edgeId);
}

// Read the graph in the shape the existing D3 frontend expects:
//   node: { id, name, type, group, ... }   edge: { source, target, relation, value, ... }
// Extra fields (qid, category, confidence, sources, ...) ride along; the FE ignores them.
export interface GraphNode {
  id: number;
  name: string;
  type: string;
  subtype: string | null;
  description: string | null;
  image: string | null;
  qid: string | null;
  group: number;
}
export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  relation: string;
  category: string;
  confidence: string;
  status: string;
  verification: string;
  directed: boolean;
  value: number; // corroboration = number of sources
  sources: SourceInput[];
}

export function getGraph(db: DB): {nodes: GraphNode[]; edges: GraphEdge[]} {
  const nodeRows = db
    .prepare('SELECT id, canonical_name AS name, type, subtype, description, image, qid FROM entities')
    .all() as unknown as Omit<GraphNode, 'group'>[];
  const nodes = nodeRows.map((n) => ({...n, group: n.type === 'person' ? 1 : 2}));

  const edgeRows = db
    .prepare(
      `SELECT e.id, e.src_entity_id AS source, e.tgt_entity_id AS target, e.relation, e.category,
              e.confidence, e.status, e.verification, e.directed, COUNT(s.id) AS value
       FROM edges e LEFT JOIN edge_sources s ON s.edge_id = e.id
       GROUP BY e.id`,
    )
    .all() as unknown as Array<Omit<GraphEdge, 'directed' | 'sources'> & {directed: number}>;

  const srcStmt = db.prepare(
    'SELECT url, outlet, published_date AS publishedDate, quote FROM edge_sources WHERE edge_id = ?',
  );
  const edges: GraphEdge[] = edgeRows.map((e) => ({
    ...e,
    directed: !!e.directed,
    sources: srcStmt.all(e.id) as unknown as SourceInput[],
  }));

  return {nodes, edges};
}
