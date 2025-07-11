import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = process.env.PORT || 3001;

// Enable CORS
app.use(cors());
app.use(express.json());

// Load graph data
let graphData: any = null;

async function loadGraphData() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'graph.json'), 'utf-8');
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

// Start server
async function startServer() {
  await loadGraphData();
  
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

startServer().catch(console.error);