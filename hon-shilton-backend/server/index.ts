import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

const app = express();
const port = process.env.PORT || 3001;

// Enable CORS
app.use(cors());
app.use(express.json());

// Load graph data
let graphData: any = null;

async function loadGraphData() {
  try {
    const data = await fsPromises.readFile(path.join(__dirname, 'graph.json'), 'utf-8');
    graphData = JSON.parse(data);
    console.log('Graph data loaded successfully');
  } catch (error) {
    console.error('Error loading graph data:', error);
    process.exit(1);
  }
}

// API endpoints
app.get('/Nodes', (req, res) => {
  if (!graphData) {
    return res.status(503).json({ error: 'Graph data not loaded' });
  }
  res.json(graphData.nodes || []);
});

app.get('/Edges', (req, res) => {
  if (!graphData) {
    return res.status(503).json({ error: 'Graph data not loaded' });
  }
  res.json(graphData.edges || []);
});

// Serve graph-addition.json file
app.get('/graph-addition.json', async (req, res) => {
  try {
    const additionalDataPath = path.join(__dirname, 'graph-addition.json');
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
});

// Start server
async function startServer() {
  await loadGraphData();
  
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

startServer().catch(console.error);