import path from 'node:path';

export const DEFAULT_DB =
  process.env.GRAPH_DB_PATH ?? path.resolve(import.meta.dirname, '../../hon-shilton-backend/server/graph.db');
