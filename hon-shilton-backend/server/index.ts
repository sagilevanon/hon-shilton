import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { getNodes, getEdges, getGraphAddition, GraphRequest } from './endpoints.js';

// Get the directory path for the current module (ES modules replacement for __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

// Enable CORS
app.use(cors());
app.use(express.json());

// Load graph data
let graphData: any = null;
let customPath: string | undefined;

async function loadGraphData() {
  try {
    // Use the custom path if provided, otherwise use the directory where this file is located
    const graphPath = customPath ? 
      path.join(customPath, 'graph.json') : 
      path.join(__dirname, 'graph.json');
      
    const data = await fsPromises.readFile(graphPath, 'utf-8');
    graphData = JSON.parse(data);
    // Graph data loaded successfully
  } catch (error) {
    console.error(`Error loading graph data from ${customPath || __dirname}:`, error);
    process.exit(1);
  }
}

// Middleware to attach graph data and custom path to the request object
app.use((req: GraphRequest, res, next) => {
  req.graphData = graphData;
  req.customPath = customPath;
  next();
});

// API endpoints
app.get('/Nodes', getNodes);
app.get('/Edges', getEdges);
app.get('/graph-addition.json', getGraphAddition);

// Start server
async function startServer(pathArg?: string) {
  customPath = pathArg || __dirname;
  await loadGraphData();
  
  app.listen(port, () => {
    // Server is running on http://localhost:${port}
  });
}

startServer(process.argv[2]).catch(console.error);