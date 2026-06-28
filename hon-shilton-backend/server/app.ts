import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  getNodes,
  getEdges,
  getSearch,
  getNeighbors,
  getSubgraph,
  getGraphAddition,
  getReviewQueue,
  postReview,
  getConfig,
} from './endpoints.js';

// Builds the graph API: the SQLite-backed read endpoints plus the optional
// Phase-4 review write. The store is initialized separately (initStore) so this
// stays a pure wiring factory shared by the server and the tests.
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cors);

  app.get('/config', getConfig);
  app.get('/Nodes', getNodes);
  app.get('/Edges', getEdges);
  app.get('/search', getSearch);
  app.get('/neighbors/:id', getNeighbors);
  app.get('/subgraph', getSubgraph);
  app.get('/review/queue', getReviewQueue);
  app.post('/review/:edgeId', postReview);
  app.get('/graph-addition.json', getGraphAddition);

  return app;
}
