import { Node, Edge, ReviewItem, ReviewAction, SearchResult, NeighborGraph } from '@/types';

// Using relative path to leverage Vite's proxy
const API_BASE = '/api';

async function getJson<T>(path: string, what: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`Failed to fetch ${what}`);
  return response.json();
}

async function postJson(path: string, body: unknown, what: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Failed to ${what}`);
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

export interface ReviewQueue {
  items: ReviewItem[];
  total: number;
}

export interface AppConfig {
  reviewGate: boolean;
}

export const NodeAPI = {
  list: (): Promise<Node[]> => getJson('/Nodes', 'nodes'),
};

export const EdgeAPI = {
  list: (): Promise<Edge[]> => getJson('/Edges', 'edges'),
};

export const SearchAPI = {
  query: (q: string, limit = 12): Promise<SearchResult[]> =>
    getJson(`/search?q=${encodeURIComponent(q)}&limit=${limit}`, 'search results'),
};

export const NeighborAPI = {
  get: (id: number, limit?: number): Promise<NeighborGraph> =>
    getJson(`/neighbors/${id}${limit ? `?limit=${limit}` : ''}`, 'neighbors'),
};

export const GraphAPI = {
  getAdditionalData: (): Promise<GraphData> => getJson('/graph-addition.json', 'additional graph data'),
};

export const ConfigAPI = {
  get: (): Promise<AppConfig> => getJson('/config', 'config'),
};

export const ReviewAPI = {
  queue: (limit: number, offset: number): Promise<ReviewQueue> =>
    getJson(`/review/queue?limit=${limit}&offset=${offset}`, 'review queue'),

  decide: (edgeId: number, action: ReviewAction): Promise<void> =>
    postJson(`/review/${edgeId}`, { action }, 'submit review decision'),
};
