// Print the current graph (display shape) from the SQLite file — verification.
//   npm run dump -- [DB_PATH]

import path from 'node:path';
import { openDb, getGraph } from './db.js';

const DEFAULT_DB = process.env.GRAPH_DB_PATH ?? path.resolve(import.meta.dirname, '../../hon-shilton-backend/server/graph.db');

const db = openDb(process.argv[2] ?? DEFAULT_DB);
const g = getGraph(db);
console.log(JSON.stringify(g, null, 2));
console.error(`\n${g.nodes.length} nodes, ${g.edges.length} edges`);
