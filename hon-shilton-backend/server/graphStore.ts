// Read/write view of the SQLite graph DB (written by hon-shilton-pipeline).
// The public graph serves the display shape the D3 frontend expects, gated to
// APPROVED edges only (Phase 4 review gate). The review queue exposes the
// PROPOSED edges and the approve/reject write. If the DB file has no graph
// tables yet (pipeline never run), reports not-ready so endpoints return 503.

import { DatabaseSync } from 'node:sqlite';

export enum ReviewAction {
  Approve = 'approve',
  Reject = 'reject',
}

// Edge lifecycle states (mirror the pipeline's SQLite CHECK; the backend can't
// import the pipeline package, so it keeps its own copy of the vocabulary).
enum EdgeStatus {
  Proposed = 'proposed',
  Approved = 'approved',
  Rejected = 'rejected',
}

const STATUS_OF: Record<ReviewAction, EdgeStatus> = {
  [ReviewAction.Approve]: EdgeStatus.Approved,
  [ReviewAction.Reject]: EdgeStatus.Rejected,
};

let db: DatabaseSync | null = null;
let ready = false;
let reviewGate = false;

export interface StoreOptions {
  reviewGate?: boolean;
}

export function initStore(dbPath: string, options: StoreOptions = {}): void {
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  // Wait out (rather than 503 on) the brief write lock held by the pipeline.
  db.exec('PRAGMA busy_timeout = 5000;');
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities'").get();
  ready = !!t;
  reviewGate = options.reviewGate ?? false;
}

export function isReady(): boolean {
  return ready && db !== null;
}

export function isReviewGateEnabled(): boolean {
  return reviewGate;
}

// Which edges are visible in the public graph. With the review gate ON, only
// human-approved edges show. With it OFF (default), extracted edges show
// directly — but Phase-5 auto-rejected (unsupported) edges stay hidden either way.
function visibleEdgeCondition(col: string): string {
  return reviewGate ? `${col} = '${EdgeStatus.Approved}'` : `${col} != '${EdgeStatus.Rejected}'`;
}

interface NodeRow {
  id: number;
  name: string;
  type: string;
  description: string | null;
  image: string | null;
  qid: string | null;
  aliases: string | null;
}

// Display-shape columns the frontend renders, including the provenance the node
// panel surfaces (qid → Wikidata link, aliases). subtype stays in the DB unused.
const entityColumns = (t: string) =>
  `${t}.id, ${t}.canonical_name AS name, ${t}.type, ${t}.description, ${t}.image, ${t}.qid,
   (SELECT group_concat(al.alias, char(10)) FROM aliases al WHERE al.entity_id = ${t}.id) AS aliases`;

function toDisplayNode(n: NodeRow): Record<string, unknown> {
  const { aliases, ...rest } = n;
  return { ...rest, group: rest.type === 'person' ? 1 : 2, aliases: aliases ? aliases.split('\n') : [] };
}

// "entity is touched by at least one visible edge" — the egocentric/public scope.
function visibleConnected(idCol: string): string {
  const cond = visibleEdgeCondition('status');
  return `${idCol} IN (SELECT src_entity_id FROM edges WHERE ${cond}
                       UNION SELECT tgt_entity_id FROM edges WHERE ${cond})`;
}

function entitiesByIds(ids: number[]): NodeRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db!
    .prepare(`SELECT ${entityColumns('en')} FROM entities en WHERE en.id IN (${placeholders})`)
    .all(...ids) as unknown as NodeRow[];
}

// Only entities connected by a visible edge — no orphan nodes in the graph.
export function getNodes(): unknown[] {
  if (!isReady()) return [];
  const rows = db!
    .prepare(`SELECT ${entityColumns('en')} FROM entities en WHERE ${visibleConnected('en.id')}`)
    .all() as unknown as NodeRow[];
  return rows.map(toDisplayNode);
}

// Attach provenance to a set of edges with a single batched query (not one
// SELECT per edge), grouping sources back onto their edge in memory.
function withSources(rows: Array<{ id: number; directed?: number } & Record<string, unknown>>): unknown[] {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const srcRows = db!
    .prepare(
      `SELECT edge_id AS edgeId, url, outlet, published_date AS publishedDate, quote
       FROM edge_sources WHERE edge_id IN (${placeholders})`,
    )
    .all(...rows.map((e) => e.id)) as unknown as Array<{ edgeId: number } & Record<string, unknown>>;

  const byEdge = new Map<number, unknown[]>();
  for (const { edgeId, ...source } of srcRows) {
    const list = byEdge.get(edgeId);
    if (list) list.push(source);
    else byEdge.set(edgeId, [source]);
  }
  return rows.map((e) => ({ ...e, directed: !!e.directed, sources: byEdge.get(e.id) ?? [] }));
}

// Selects what the graph renders: source/target/relation, category (edge color +
// filter), value for edge thickness, directed + provenance. confidence/status/
// verification gate the query (the WHERE) but aren't part of the rendered edge.
export function getEdges(): unknown[] {
  if (!isReady()) return [];
  const rows = db!
    .prepare(
      `SELECT e.id, e.src_entity_id AS source, e.tgt_entity_id AS target, e.relation, e.category,
              e.directed, COUNT(s.id) AS value
       FROM edges e LEFT JOIN edge_sources s ON s.edge_id = e.id
       WHERE ${visibleEdgeCondition('e.status')}
       GROUP BY e.id`,
    )
    .all() as unknown as Array<{ id: number; directed: number } & Record<string, unknown>>;
  return withSources(rows);
}

interface SearchRow extends NodeRow {
  degree: number;
}

// Egocentric entry point: entities whose canonical_name or any alias matches,
// restricted to the visible-graph scope and ranked by degree (most-connected
// first). An empty query lists the most-connected entities — a browse/suggest
// affordance for the search-first landing.
export function searchEntities(q: string, limit: number): unknown[] {
  if (!isReady()) return [];
  const term = q.trim();
  const cond = visibleEdgeCondition('e.status');
  const degree = `(SELECT COUNT(*) FROM edges e
                   WHERE (e.src_entity_id = en.id OR e.tgt_entity_id = en.id) AND ${cond})`;
  const base = `SELECT DISTINCT ${entityColumns('en')}, ${degree} AS degree
                FROM entities en LEFT JOIN aliases a ON a.entity_id = en.id
                WHERE ${visibleConnected('en.id')}`;
  const tail = ' ORDER BY degree DESC, en.canonical_name LIMIT ?';

  const rows =
    term === ''
      ? (db!.prepare(`${base}${tail}`).all(limit) as unknown as SearchRow[])
      : (db!
          .prepare(`${base} AND (en.canonical_name LIKE ? OR a.alias LIKE ?)${tail}`)
          .all(`%${term}%`, `%${term}%`, limit) as unknown as SearchRow[]);

  return rows.map((r) => ({ ...toDisplayNode(r), degree: r.degree }));
}

interface NeighborEdgeRow {
  id: number;
  source: number;
  target: number;
  relation: string;
  category: string;
  directed: number;
  value: number;
}

export interface NeighborResult {
  nodes: unknown[];
  edges: unknown[];
  focalId: number;
  shown: number;
  total: number;
}

// One hop out from a focal entity: the focal node + its directly-connected
// neighbors and the visible edges between them. Capped at `limit` and ranked
// corroboration → confidence → recency so a high-degree hub returns its
// strongest links first (the rest reachable via a larger limit / "show more").
export function getNeighbors(id: number, limit: number): NeighborResult {
  if (!isReady()) return { nodes: [], edges: [], focalId: id, shown: 0, total: 0 };
  const cond = visibleEdgeCondition('e.status');
  const touches = `(e.src_entity_id = ? OR e.tgt_entity_id = ?) AND ${cond}`;

  const total = (
    db!.prepare(`SELECT COUNT(*) AS n FROM edges e WHERE ${touches}`).get(id, id) as { n: number }
  ).n;

  const edgeRows = db!
    .prepare(
      `SELECT e.id, e.src_entity_id AS source, e.tgt_entity_id AS target, e.relation, e.category,
              e.directed, COUNT(s.id) AS value
       FROM edges e LEFT JOIN edge_sources s ON s.edge_id = e.id
       WHERE ${touches}
       GROUP BY e.id
       ORDER BY value DESC,
                CASE e.confidence WHEN 'high' THEN 3 WHEN 'med' THEN 2 ELSE 1 END DESC,
                e.created_at DESC
       LIMIT ?`,
    )
    .all(id, id, limit) as unknown as Array<NeighborEdgeRow & Record<string, unknown>>;

  const ids = new Set<number>([id]);
  for (const e of edgeRows) {
    ids.add(e.source);
    ids.add(e.target);
  }

  return {
    nodes: entitiesByIds([...ids]).map(toDisplayNode),
    edges: withSources(edgeRows),
    focalId: id,
    shown: edgeRows.length,
    total,
  };
}

// Proposed edges awaiting review, with their entity names + provenance. Paged.
export function getReviewQueue(limit: number, offset: number): { items: unknown[]; total: number } {
  if (!isReady()) return { items: [], total: 0 };
  const total = (
    db!.prepare(`SELECT COUNT(*) AS n FROM edges WHERE status = '${EdgeStatus.Proposed}'`).get() as { n: number }
  ).n;
  const rows = db!
    .prepare(
      `SELECT e.id, e.relation, e.category, e.confidence, e.verification, e.directed,
              src.canonical_name AS source, tgt.canonical_name AS target
       FROM edges e
       JOIN entities src ON src.id = e.src_entity_id
       JOIN entities tgt ON tgt.id = e.tgt_entity_id
       WHERE e.status = '${EdgeStatus.Proposed}'
       ORDER BY e.id
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as unknown as Array<{ id: number; directed: number } & Record<string, unknown>>;
  return { items: withSources(rows), total };
}

// Apply an approve/reject decision. Returns false if the edge does not exist.
export function setEdgeStatus(edgeId: number, action: ReviewAction): boolean {
  if (!isReady()) return false;
  const res = db!.prepare('UPDATE edges SET status = ? WHERE id = ?').run(STATUS_OF[action], edgeId);
  return res.changes > 0;
}
