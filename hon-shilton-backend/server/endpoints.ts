import { FastifyRequest, FastifyReply } from 'fastify';
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
export async function getConfig(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ reviewGate: isReviewGateEnabled() });
}

// GET /Nodes — entities from SQLite, in the display shape.
export async function getNodes(_req: FastifyRequest, reply: FastifyReply) {
  if (!isReady()) return reply.code(503).send(NOT_READY);
  return reply.send(storeNodes());
}

// GET /Edges — approved relationships from SQLite, in the display shape.
export async function getEdges(_req: FastifyRequest, reply: FastifyReply) {
  if (!isReady()) return reply.code(503).send(NOT_READY);
  return reply.send(storeEdges());
}

// GET /search?q=&limit= — entities matching name/alias (visible scope), ranked
// by degree. Empty q lists the most-connected entities (browse/suggest).
export async function getSearch(req: FastifyRequest, reply: FastifyReply) {
  if (!isReady()) return reply.code(503).send(NOT_READY);
  const query = req.query as { q?: unknown; limit?: unknown };
  const q = typeof query.q === 'string' ? query.q : '';
  const limit = clampInt(query.limit, DEFAULT_LIMIT, 1, 50);
  return reply.send(storeSearch(q, limit));
}

// GET /neighbors/:id?limit= — focal entity + its 1-hop neighbors (capped, ranked).
export async function getNeighbors(req: FastifyRequest, reply: FastifyReply) {
  if (!isReady()) return reply.code(503).send(NOT_READY);
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id)) return reply.code(400).send({ error: 'expected an integer entity id' });
  const limit = clampInt((req.query as { limit?: unknown }).limit, NEIGHBOR_LIMIT, 1, 100);
  return reply.send(storeNeighbors(id, limit));
}

// GET /review/queue?limit=&offset= — proposed edges awaiting review.
export async function getReviewQueue(req: FastifyRequest, reply: FastifyReply) {
  if (!isReady()) return reply.code(503).send(NOT_READY);
  const query = req.query as { limit?: unknown; offset?: unknown };
  const limit = clampInt(query.limit, DEFAULT_LIMIT, 1, 100);
  const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  return reply.send(storeReviewQueue(limit, offset));
}

// POST /review/:edgeId  { action: 'approve' | 'reject' }
export async function postReview(req: FastifyRequest, reply: FastifyReply) {
  if (!isReady()) return reply.code(503).send(NOT_READY);
  const edgeId = Number((req.params as { edgeId?: string }).edgeId);
  const action = ((req.body as { action?: unknown } | null) ?? {}).action;
  if (!Number.isInteger(edgeId) || !isReviewAction(action)) {
    return reply.code(400).send({ error: "expected an integer edgeId and action 'approve' | 'reject'" });
  }
  if (!setEdgeStatus(edgeId, action)) return reply.code(404).send({ error: `no edge with id ${edgeId}` });
  return reply.send({ id: edgeId, action });
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
export async function getGraphAddition(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const p = path.join(__dirname, 'graph-addition.json');
    const exists = await fsPromises
      .access(p)
      .then(() => true)
      .catch(() => false);
    if (!exists) return reply.code(404).send({ error: 'Additional graph data not found' });
    return reply.send(JSON.parse(await fsPromises.readFile(p, 'utf8')));
  } catch (error) {
    console.error('Error serving additional graph data:', error);
    return reply.code(500).send({ error: 'Failed to load additional graph data' });
  }
}
