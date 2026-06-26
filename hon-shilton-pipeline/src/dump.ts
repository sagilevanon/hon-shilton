// Print the full graph (all statuses, with status + verification) from the
// SQLite file — a local debug view. The public backend graph serves approved
// edges only; this dump shows everything for inspecting the pipeline/review.
//   npm run dump -- [DB_PATH]

import { openDb, getGraph } from './db.js';
import { DEFAULT_DB } from './paths.js';

const db = openDb(process.argv[2] ?? DEFAULT_DB);
const g = getGraph(db);
console.log(JSON.stringify(g, null, 2));
console.error(`\n${g.nodes.length} nodes, ${g.edges.length} edges`);
