import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { getNodes, getEdges, getGraphAddition, GraphRequest } from './endpoints';

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
    const data = await fsPromises.readFile(path.join(customPath || __dirname, 'graph.json'), 'utf-8');
    graphData = JSON.parse(data);
    console.log('Graph data loaded successfully');
  } catch (error) {
    console.error('Error loading graph data:', error);
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
    console.log(`Server is running on http://localhost:${port}`);
  });
}

startServer(process.argv[2]).catch(console.error);