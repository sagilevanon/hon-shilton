import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNodes, getEdges, getGraphAddition } from './endpoints.js';
import { initStore } from './graphStore.js';

// ES modules replacement for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Read-only graph API, served from the SQLite file written by the pipeline.
app.get('/Nodes', getNodes);
app.get('/Edges', getEdges);
app.get('/graph-addition.json', getGraphAddition);

// DB path resolution: CLI arg, then env, then alongside this server.
const dbPath = process.argv[2] || process.env.GRAPH_DB_PATH || path.join(__dirname, 'graph.db');
initStore(dbPath);

app.listen(port, () => {
  console.log(`Hon Shilton read API on http://localhost:${port} (db: ${dbPath})`);
});
