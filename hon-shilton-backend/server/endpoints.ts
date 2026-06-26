import { Request, Response } from 'express';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import {
  getNodes as storeNodes,
  getEdges as storeEdges,
  searchEntities as storeSearch,
  getNeighbors as storeNeighbors,
  getReviewQueue as storeReviewQueue,
  setEdgeStatus,
  ReviewAction,
  isReady,
  isReviewGateEnabled,
} from './graphStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NOT_READY = { error: 'Graph store not initialized — run the pipeline (hon-shilton-pipeline) first' };
const DEFAULT_LIMIT = 20;
const NEIGHBOR_LIMIT = 8;

// GET /config — feature flags the frontend adapts to (e.g. whether to show the
// review queue). Available before the DB is populated.
export async function getConfig(_req: Request, res: Response) {
  res.json({ reviewGate: isReviewGateEnabled() });
}

// GET /Nodes — entities from SQLite, in the display shape.
export async function getNodes(_req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  res.json(storeNodes());
}

// GET /Edges — approved relationships from SQLite, in the display shape.
export async function getEdges(_req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  res.json(storeEdges());
}

// GET /search?q=&limit= — entities matching name/alias (visible scope), ranked
// by degree. Empty q lists the most-connected entities (browse/suggest).
export async function getSearch(req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, 50);
  res.json(storeSearch(q, limit));
}

// GET /neighbors/:id?limit= — focal entity + its 1-hop neighbors (capped, ranked).
export async function getNeighbors(req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'expected an integer entity id' });
  const limit = clampInt(req.query.limit, NEIGHBOR_LIMIT, 1, 100);
  res.json(storeNeighbors(id, limit));
}

// GET /review/queue?limit=&offset= — proposed edges awaiting review.
export async function getReviewQueue(req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, 100);
  const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  res.json(storeReviewQueue(limit, offset));
}

// POST /review/:edgeId  { action: 'approve' | 'reject' }
export async function postReview(req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  const edgeId = Number(req.params.edgeId);
  const action = (req.body ?? {}).action;
  if (!Number.isInteger(edgeId) || !isReviewAction(action)) {
    return res.status(400).json({ error: "expected an integer edgeId and action 'approve' | 'reject'" });
  }
  if (!setEdgeStatus(edgeId, action)) return res.status(404).json({ error: `no edge with id ${edgeId}` });
  res.json({ id: edgeId, action });
}

function isReviewAction(v: unknown): v is ReviewAction {
  return v === ReviewAction.Approve || v === ReviewAction.Reject;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// GET /graph-addition.json — legacy node-expansion data (superseded in a later
// phase by neighbor queries). Served from disk if present.
export async function getGraphAddition(_req: Request, res: Response) {
  try {
    const p = path.join(__dirname, 'graph-addition.json');
    const exists = await fsPromises
      .access(p)
      .then(() => true)
      .catch(() => false);
    if (!exists) return res.status(404).json({ error: 'Additional graph data not found' });
    res.json(JSON.parse(await fsPromises.readFile(p, 'utf8')));
  } catch (error) {
    console.error('Error serving additional graph data:', error);
    res.status(500).json({ error: 'Failed to load additional graph data' });
  }
}
