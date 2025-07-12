import { Request, Response } from 'express';
import path from 'path';
import { promises as fsPromises } from 'fs';

// Type for the extended request with graph data
export interface GraphRequest extends Request {
  graphData?: any;
  customPath?: string;
}

// Nodes endpoint handler
export async function getNodes(req: GraphRequest, res: Response) {
  const graphData = req.graphData;
  
  if (!graphData) {
    return res.status(503).json({ error: 'Graph data not loaded' });
  }
  
  res.json(graphData.nodes || []);
}

// Edges endpoint handler
export async function getEdges(req: GraphRequest, res: Response) {
  const graphData = req.graphData;
  
  if (!graphData) {
    return res.status(503).json({ error: 'Graph data not loaded' });
  }
  
  res.json(graphData.edges || []);
}

// Graph addition endpoint handler
export async function getGraphAddition(req: GraphRequest, res: Response) {
  try {
    const customPath = req.customPath || '';
    const additionalDataPath = path.join(customPath || __dirname, 'graph-addition.json');
    
    const fileExists = await fsPromises.access(additionalDataPath)
      .then(() => true)
      .catch(() => false);
    
    if (!fileExists) {
      return res.status(404).json({ error: 'Additional graph data not found' });
    }
    
    const additionalData = await fsPromises.readFile(additionalDataPath, 'utf8');
    res.json(JSON.parse(additionalData));
  } catch (error) {
    console.error('Error serving additional graph data:', error);
    res.status(500).json({ error: 'Failed to load additional graph data' });
  }
}
