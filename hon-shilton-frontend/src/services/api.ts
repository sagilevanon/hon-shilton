import { Node, Edge } from '@/types';

// Using relative path to leverage Vite's proxy
const API_BASE = '/api';

export const NodeAPI = {
  list: async (): Promise<Node[]> => {
    console.log('Fetching nodes from:', `${API_BASE}/Nodes`);
    const response = await fetch(`${API_BASE}/Nodes`);
    if (!response.ok) {
      throw new Error('Failed to fetch nodes');
    }
    return response.json();
  },
};

export const EdgeAPI = {
  list: async (): Promise<Edge[]> => {
    console.log('Fetching edges from:', `${API_BASE}/Edges`);
    const response = await fetch(`${API_BASE}/Edges`);
    if (!response.ok) {
      throw new Error('Failed to fetch edges');
    }
    return response.json();
  },
};
