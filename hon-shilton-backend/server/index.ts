import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getNodes,
  getEdges,
  getSearch,
  getNeighbors,
  getGraphAddition,
  getReviewQueue,
  postReview,
  getConfig,
} from './endpoints.js';
import { initStore } from './graphStore.js';

// REVIEW_GATE (default off): when on, the public graph serves approved edges
// only and the review queue is the publishing gate.
function isFlagOn(value: string | undefined): boolean {
  return value != null && ['1', 'true', 'on', 'yes'].includes(value.toLowerCase());
}

// ES modules replacement for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Graph API + optional review gate, served from the SQLite file the pipeline
// writes. The review routes also write edge status back to the DB.
app.get('/config', getConfig);
app.get('/Nodes', getNodes);
app.get('/Edges', getEdges);
app.get('/search', getSearch);
app.get('/neighbors/:id', getNeighbors);
app.get('/review/queue', getReviewQueue);
app.post('/review/:edgeId', postReview);
app.get('/graph-addition.json', getGraphAddition);

// DB path resolution: CLI arg, then env, then the pipeline-written server/graph.db.
// Under the compiled build __dirname is dist/server, so resolve back to source server/.
const compiled = __dirname.endsWith(`${path.sep}dist${path.sep}server`);
const serverDir = compiled ? path.join(__dirname, '..', '..', 'server') : __dirname;
const dbPath = process.argv[2] || process.env.GRAPH_DB_PATH || path.join(serverDir, 'graph.db');
const reviewGate = isFlagOn(process.env.REVIEW_GATE);
try {
  initStore(dbPath, { reviewGate });
} catch (err) {
  console.error(`Failed to open graph DB at ${dbPath}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

app.listen(port, () => {
  console.log(`Hon Shilton API on http://localhost:${port} (db: ${dbPath}, review gate: ${reviewGate ? 'on' : 'off'})`);
});
