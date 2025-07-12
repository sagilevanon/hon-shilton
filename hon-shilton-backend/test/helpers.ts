import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';

// Get the directory path for the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data directory paths
const getTestDataDir = (): string => path.join(__dirname, 'data');
const getTempTestDataDir = (): string => path.join(__dirname, 'temp');

// Define interfaces for graph data
interface Node {
  id: number;
  name: string;
  type: string;
}

interface Edge {
  source: number;
  target: number;
  type: string;
}

interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Sets up the test environment by creating a temporary test data directory
 * and copying test data files into it
 * @returns Path to the temporary test data directory
 */
export async function setupTestEnvironment(): Promise<string> {
  // Create temp directory if it doesn't exist
  const tempDir = getTempTestDataDir();
  
  try {
    await fsPromises.mkdir(tempDir, { recursive: true });
    // Temporary test directory created
    
    // Copy test graph.json to temp directory
    const sourceGraphPath = path.join(getTestDataDir(), 'graph.json');
    const targetGraphPath = path.join(tempDir, 'graph.json');
    
    // Create a simple test graph.json if it doesn't exist
    if (!fs.existsSync(sourceGraphPath)) {
      const testGraphData: GraphData = {
        nodes: [
          { id: 1, name: "Test Node 1", type: "person" },
          { id: 2, name: "Test Node 2", type: "person" }
        ],
        edges: [
          { source: 1, target: 2, type: "knows" }
        ]
      };
      
      await fsPromises.writeFile(targetGraphPath, JSON.stringify(testGraphData, null, 2));
      // Test graph.json created
    } else {
      await fsPromises.copyFile(sourceGraphPath, targetGraphPath);
      // Graph.json copied to temp directory
    }
    
    // Copy test graph-addition.json to temp directory
    const sourceAdditionPath = path.join(getTestDataDir(), 'graph-addition.json');
    const targetAdditionPath = path.join(tempDir, 'graph-addition.json');
    
    // Create a simple test graph-addition.json if it doesn't exist
    if (!fs.existsSync(sourceAdditionPath)) {
      const testAdditionData: GraphData = {
        nodes: [
          { id: 3, name: "Test Node 3", type: "person" }
        ],
        edges: [
          { source: 1, target: 3, type: "knows" }
        ]
      };
      
      await fsPromises.writeFile(targetAdditionPath, JSON.stringify(testAdditionData, null, 2));
      // Test graph-addition.json created
    } else {
      await fsPromises.copyFile(sourceAdditionPath, targetAdditionPath);
      // Graph-addition.json copied to temp directory
    }
    
    return tempDir;
  } catch (error) {
    // Error handling for test environment setup
    throw error;
  }
}

/**
 * Cleans up the test environment by removing the temporary test data directory
 */
export async function cleanupTestEnvironment(): Promise<void> {
  const tempDir = getTempTestDataDir();
  
  try {
    // Check if directory exists before attempting to remove
    const exists = await fsPromises.access(tempDir)
      .then(() => true)
      .catch(() => false);
    
    if (exists) {
      // Remove all files in the directory
      const files = await fsPromises.readdir(tempDir);
      for (const file of files) {
        await fsPromises.unlink(path.join(tempDir, file));
      }
      
      // Remove the directory
      await fsPromises.rmdir(tempDir);
      // Temporary test directory removed
    }
  } catch (error) {
    // Error handling for test environment cleanup
  }
}
