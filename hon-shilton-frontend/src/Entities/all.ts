// Import types from the types file
import { Node, Edge } from './types';

// Mock API functions that would normally fetch from a backend
export const NodeAPI = {
  list: async (): Promise<Node[]> => {
    // In a real app, this would be a fetch call
    return [];
  },
};

export const EdgeAPI = {
  list: async (): Promise<Edge[]> => {
    // In a real app, this would be a fetch call
    return [];
  },
};

// Export the API types
export type { Node, Edge };
