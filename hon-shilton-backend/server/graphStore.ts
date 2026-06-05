// Read-only view of the SQLite graph DB (written by hon-shilton-pipeline).
// Serves the display shape the existing D3 frontend expects. If the DB file
// has no graph tables yet (pipeline never run), reports not-ready so endpoints
// return 503 rather than crashing.

import { DatabaseSync } from 'node:sqlite';

let db: DatabaseSync | null = null;
let ready = false;

export function initStore(dbPath: string): void {
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities'").get();
  ready = !!t;
}

export function isReady(): boolean {
  return ready && db !== null;
}

interface NodeRow {
  id: number;
  name: string;
  type: string;
  subtype: string | null;
  description: string | null;
  image: string | null;
  qid: string | null;
}

export function getNodes(): unknown[] {
  if (!isReady()) return [];
  const rows = db!
    .prepare('SELECT id, canonical_name AS name, type, subtype, description, image, qid FROM entities')
    .all() as unknown as NodeRow[];
  return rows.map((n) => ({ ...n, group: n.type === 'person' ? 1 : 2 }));
}

export function getEdges(): unknown[] {
  if (!isReady()) return [];
  const rows = db!
    .prepare(
      `SELECT e.id, e.src_entity_id AS source, e.tgt_entity_id AS target, e.relation, e.category,
              e.confidence, e.status, e.directed, COUNT(s.id) AS value
       FROM edges e LEFT JOIN edge_sources s ON s.edge_id = e.id
       GROUP BY e.id`,
    )
    .all() as unknown as Array<{ id: number; directed: number } & Record<string, unknown>>;
  const srcStmt = db!.prepare(
    'SELECT url, outlet, published_date AS publishedDate, quote FROM edge_sources WHERE edge_id = ?',
  );
  return rows.map((e) => ({ ...e, directed: !!e.directed, sources: srcStmt.all(e.id) }));
}
