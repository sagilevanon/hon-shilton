import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';

// Get the directory path for the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import endpoints directly from source
import { getNodes, getEdges, getGraphAddition, GraphRequest } from '../server/endpoints.ts';
import { setupTestEnvironment, cleanupTestEnvironment } from './helpers.ts';

// Test server and request
let app: express.Application;
let request: any; // Using any to avoid TypeScript errors with supertest
let testDataDir: string;

describe('Endpoints Tests', async () => {
  // Set up test environment before all tests
  before(async () => {
    // Set up test environment (create temp data files)
    testDataDir = await setupTestEnvironment();
    
    // Create a new Express app for testing
    app = express();
    
    // Load test graph data
    let graphData = null;
    try {
      const data = await fsPromises.readFile(path.join(testDataDir, 'graph.json'), 'utf-8');
      graphData = JSON.parse(data);
      // Test graph data loaded successfully
    } catch (error) {
      // Re-throw any errors loading test data
      throw error;
    }
    
    // Middleware to attach graph data and custom path to the request
    app.use((req: GraphRequest, res, next) => {
      req.graphData = graphData;
      req.customPath = testDataDir;
      next();
    });
    
    // Set up endpoints for testing
    app.get('/Nodes', getNodes);
    app.get('/Edges', getEdges);
    app.get('/graph-addition.json', getGraphAddition);
    
    // Create supertest instance
    request = supertest(app);
  });
  
  // Clean up after all tests
  after(async () => {
    await cleanupTestEnvironment();
  });
  
  // Test the Nodes endpoint
  it('should return nodes from graph data', async () => {
    const response = await request.get('/Nodes');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(response.body.length > 0);
    
    // Check if nodes have expected properties
    const firstNode = response.body[0];
    assert.ok('id' in firstNode);
    assert.ok('name' in firstNode);
  });
  
  // Test the Edges endpoint
  it('should return edges from graph data', async () => {
    const response = await request.get('/Edges');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(response.body.length > 0);
    
    // Check if edges have expected properties
    const firstEdge = response.body[0];
    assert.ok('source' in firstEdge);
    assert.ok('target' in firstEdge);
  });
  
  // Test the graph-addition.json endpoint
  it('should return additional graph data', async () => {
    const response = await request.get('/graph-addition.json');
    assert.equal(response.status, 200);
    assert.ok(response.body);
    
    // Check if additional graph data has expected structure
    assert.ok('nodes' in response.body);
    assert.ok('edges' in response.body);
    assert.ok(Array.isArray(response.body.nodes));
    assert.ok(Array.isArray(response.body.edges));
  });
  
  // Test error handling when graph data is not available
  it('should handle missing graph data', async () => {
    // Create a new app without graph data
    const appWithoutData = express();
    
    // Middleware to attach empty graph data
    appWithoutData.use((req: GraphRequest, res, next) => {
      req.graphData = null;
      req.customPath = testDataDir;
      next();
    });
    
    // Set up endpoints
    appWithoutData.get('/Nodes', getNodes);
    appWithoutData.get('/Edges', getEdges);
    
    // Create supertest instance
    const testRequest = supertest(appWithoutData);
    
    // Test Nodes endpoint with missing data
    const nodesResponse = await testRequest.get('/Nodes');
    assert.equal(nodesResponse.status, 503);
    assert.deepEqual(nodesResponse.body, { error: 'Graph data not loaded' });
    
    // Test Edges endpoint with missing data
    const edgesResponse = await testRequest.get('/Edges');
    assert.equal(edgesResponse.status, 503);
    assert.deepEqual(edgesResponse.body, { error: 'Graph data not loaded' });
  });
  
  // Test error handling for missing additional graph data
  it('should handle missing additional graph data', async () => {
    // Create a new app with invalid path
    const appWithInvalidPath = express();
    
    // Middleware to attach invalid path
    appWithInvalidPath.use((req: GraphRequest, res, next) => {
      req.graphData = {};
      req.customPath = '/invalid/path';
      next();
    });
    
    // Set up endpoint
    appWithInvalidPath.get('/graph-addition.json', getGraphAddition);
    
    // Create supertest instance
    const testRequest = supertest(appWithInvalidPath);
    
    // Test graph-addition.json endpoint with invalid path
    const response = await testRequest.get('/graph-addition.json');
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Additional graph data not found' });
  });

  it('should handle missing graph data', async () => {
    // Create a new app with invalid path
    const appWithInvalidPath = express();
    
    // Middleware to attach invalid path but set graphData to null
    appWithInvalidPath.use((req: GraphRequest, res, next) => {
      req.graphData = null;
      req.customPath = '/invalid/path';
      next();
    });
    
    // Set up endpoint
    appWithInvalidPath.get('/Nodes', getNodes);
    
    // Create supertest instance
    const testRequest = supertest(appWithInvalidPath);
    
    // Test Nodes endpoint with missing data
    const response = await testRequest.get('/Nodes');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Graph data not loaded' });
  });
});
