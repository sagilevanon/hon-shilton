import { Request, Response } from 'express';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { getNodes as storeNodes, getEdges as storeEdges, isReady } from './graphStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NOT_READY = { error: 'Graph store not initialized — run the pipeline (hon-shilton-pipeline) first' };

// GET /Nodes — entities from SQLite, in the display shape.
export async function getNodes(_req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  res.json(storeNodes());
}

// GET /Edges — relationships from SQLite, in the display shape.
export async function getEdges(_req: Request, res: Response) {
  if (!isReady()) return res.status(503).json(NOT_READY);
  res.json(storeEdges());
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
