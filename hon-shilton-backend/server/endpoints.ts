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
  getNodesByIds as storeNodesByIds,
  getEdgesByIds as storeEdgesByIds,
  getEntityDegrees as storeDegrees,
  shortestPath as storeShortestPath,
  entitiesExist as storeEntitiesExist,
  setEdgeStatus,
  ReviewAction,
  isReady,
  isReviewGateEnabled,
} from './graphStore.js';
import { findPaths } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NOT_READY = { error: 'Graph store not initialized — run the pipeline (hon-shilton-pipeline) first' };
const DEFAULT_LIMIT = 20;
const NEIGHBOR_LIMIT = 8;
const DEFAULT_HOPS = 3;
const MIN_HOPS = 2;
const MAX_HOPS = 6;

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

// GET /subgraph?from=&to=&maxHops=&exclude=&includeHubs= — up to K vertex-disjoint
// shortest paths between two entities (the connection finder), plus a flat
// node/edge union so the explorer renders with no extra fetches. Status mapping:
// 400 missing endpoint · 422 non-integer or from===to · 404 unknown entity ·
// 503 DB not ready · 200 + paths:[] for "no connection within maxHops".
export async function getSubgraph(req: FastifyRequest, reply: FastifyReply) {
  if (!isReady()) return reply.code(503).send(NOT_READY);
  const q = req.query as Record<string, unknown>;

  const from = parseEndpoint(q.from);
  const to = parseEndpoint(q.to);
  if (from.code) return reply.code(from.code).send({ error: from.error });
  if (to.code) return reply.code(to.code).send({ error: to.error });
  if (from.value === to.value) return reply.code(422).send({ error: 'from and to must be different entities' });
  if (!storeEntitiesExist([from.value, to.value])) return reply.code(404).send({ error: 'unknown entity id' });

  const maxHops = clampInt(q.maxHops, DEFAULT_HOPS, MIN_HOPS, MAX_HOPS);
  const result = findPaths(
    { shortestPath: storeShortestPath, degrees: storeDegrees },
    { from: from.value, to: to.value, maxHops, exclude: parseIdList(q.exclude), includeHubs: isTruthy(q.includeHubs) },
  );

  return reply.send({
    from: from.value,
    to: to.value,
    paths: result.paths,
    nodes: storeNodesByIds(result.nodeIds),
    edges: storeEdgesByIds(result.edgeIds),
    suppressedHubs: storeNodesByIds(result.suppressedHubIds),
  });
}

// Missing/empty → 400; present but not an integer → 422 (well-formed but unprocessable).
function parseEndpoint(v: unknown): { value: number; code?: number; error?: string } {
  if (v === undefined || v === null || v === '') return { value: NaN, code: 400, error: 'from and to are required' };
  const n = Number(v);
  if (!Number.isInteger(n)) return { value: NaN, code: 422, error: 'from and to must be integers' };
  return { value: n };
}

function parseIdList(v: unknown): number[] {
  if (typeof v !== 'string' || v === '') return [];
  return v.split(',').map(Number).filter(Number.isInteger);
}

function isTruthy(v: unknown): boolean {
  return v != null && ['1', 'true', 'on', 'yes'].includes(String(v).toLowerCase());
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
