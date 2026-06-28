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

// Confidence as a sortable rank, reused by neighbor ranking and path weakest-link.
const CONFIDENCE_RANK = "CASE e.confidence WHEN 'high' THEN 3 WHEN 'med' THEN 2 ELSE 1 END";

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

// The display columns the graph renders for every edge: source/target/relation,
// category (color + filter), value for thickness, directed + (later) provenance.
// Shared by every edge query so the rendered shape stays identical everywhere.
const EDGE_DISPLAY_SELECT = `SELECT e.id, e.src_entity_id AS source, e.tgt_entity_id AS target,
         e.relation, e.category, e.directed, COUNT(s.id) AS value
  FROM edges e LEFT JOIN edge_sources s ON s.edge_id = e.id`;

type DisplayEdgeRow = { id: number; directed: number } & Record<string, unknown>;

// Selects what the graph renders. confidence/status/verification gate the query
// (the WHERE) but aren't part of the rendered edge.
export function getEdges(): unknown[] {
  if (!isReady()) return [];
  const rows = db!
    .prepare(`${EDGE_DISPLAY_SELECT} WHERE ${visibleEdgeCondition('e.status')} GROUP BY e.id`)
    .all() as unknown as DisplayEdgeRow[];
  return withSources(rows);
}

// Hydrate an arbitrary set of edge ids into the display shape (+ sources),
// gated to the visible-graph scope. Powers the connection-finder subgraph union.
function edgesByIds(ids: number[]): unknown[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db!
    .prepare(
      `${EDGE_DISPLAY_SELECT} WHERE e.id IN (${placeholders}) AND ${visibleEdgeCondition('e.status')} GROUP BY e.id`,
    )
    .all(...ids) as unknown as DisplayEdgeRow[];
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
      `${EDGE_DISPLAY_SELECT}
       WHERE ${touches}
       GROUP BY e.id
       ORDER BY value DESC, ${CONFIDENCE_RANK} DESC, e.created_at DESC
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

// --- Connection finder (Phase 8) ---------------------------------------------
// Hydration + traversal primitives over the visible graph. The greedy K-path
// orchestration lives in paths.ts (pure); these are its SQL building blocks.

// Display nodes for an arbitrary id set — the subgraph union + suppressed hubs.
export function getNodesByIds(ids: number[]): unknown[] {
  if (!isReady()) return [];
  return entitiesByIds(ids).map(toDisplayNode);
}

// Display edges (+ sources) for an arbitrary id set — the subgraph route edges.
export function getEdgesByIds(ids: number[]): unknown[] {
  if (!isReady()) return [];
  return edgesByIds(ids);
}

// True only if every id resolves to a real entity (drives the 404 on /subgraph).
export function entitiesExist(ids: number[]): boolean {
  if (!isReady()) return false;
  return entitiesByIds(ids).length === ids.length;
}

// Degree (over visible edges) of every connected entity — the input the hub
// percentile cutoff is computed from.
export function getEntityDegrees(): Map<number, number> {
  if (!isReady()) return new Map();
  const cond = visibleEdgeCondition('status');
  const rows = db!
    .prepare(
      `SELECT id, COUNT(*) AS degree FROM (
         SELECT src_entity_id AS id FROM edges WHERE ${cond}
         UNION ALL SELECT tgt_entity_id AS id FROM edges WHERE ${cond}
       ) GROUP BY id`,
    )
    .all() as unknown as Array<{ id: number; degree: number }>;
  return new Map(rows.map((r) => [r.id, r.degree]));
}

export interface RawPath {
  nodeIds: number[];
  edgeIds: number[];
  hops: number;
}

// The single best path between two entities over the UNDIRECTED visible graph,
// avoiding an exclude set — fewest hops first, tie-broken by weakest-link
// credibility (max-of-min corroboration, then confidence). A recursive CTE walks
// the symmetric adjacency (each edge contributes both arcs), carrying the visited
// node path (cycle guard) and the bottleneck corroboration/confidence so far.
//
// The CTE enumerates every simple walk up to its hop bound, which grows
// exponentially on dense graphs. To keep that bounded we deepen the bound one hop
// at a time and stop at the first that reaches the target: since the outer query
// orders by hops first, the path found at the smallest feasible bound is exactly
// the one the full-depth query would return — so this preserves results while
// only paying the cost of the actual path length, not the full maxHops frontier.
export function shortestPath(from: number, to: number, exclude: number[], maxHops: number): RawPath | null {
  if (!isReady()) return null;
  const visible = visibleEdgeCondition('e.status');
  const corr = '(SELECT COUNT(*) FROM edge_sources s WHERE s.edge_id = e.id)';
  const arc = (a: string, b: string) =>
    `SELECT e.${a} AS a, e.${b} AS b, e.id AS edge_id, ${corr} AS corr, ${CONFIDENCE_RANK} AS conf
     FROM edges e WHERE ${visible}`;
  const excludeClause = exclude.length ? `AND arc.b NOT IN (${exclude.map(() => '?').join(',')})` : '';

  const stmt = db!.prepare(
    `WITH RECURSIVE
       arc(a, b, edge_id, corr, conf) AS (
         ${arc('src_entity_id', 'tgt_entity_id')}
         UNION ALL
         ${arc('tgt_entity_id', 'src_entity_id')}
       ),
       walk(node, hops, min_corr, min_conf, npath, epath) AS (
         SELECT ?, 0, 1000000, 1000000, ',' || ? || ',', ''
         UNION ALL
         SELECT arc.b, walk.hops + 1,
                MIN(walk.min_corr, arc.corr), MIN(walk.min_conf, arc.conf),
                walk.npath || arc.b || ',', walk.epath || arc.edge_id || ','
         FROM walk JOIN arc ON arc.a = walk.node
         WHERE walk.hops < ? AND walk.node != ?
           AND instr(walk.npath, ',' || arc.b || ',') = 0
           ${excludeClause}
       )
     SELECT npath, epath, hops FROM walk
     WHERE node = ?
     ORDER BY hops ASC, min_corr DESC, min_conf DESC
     LIMIT 1`,
  );

  const toIds = (s: string) => s.split(',').filter(Boolean).map(Number);
  for (let bound = 1; bound <= maxHops; bound++) {
    const row = stmt.get(from, from, bound, to, ...exclude, to) as
      | { npath: string; epath: string; hops: number }
      | undefined;
    if (row) return { nodeIds: toIds(row.npath), edgeIds: toIds(row.epath), hops: row.hops };
  }
  return null;
}
