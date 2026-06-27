export interface Node {
  id: number;
  name: string;
  group: number;
  type: string;
  image?: string;
  description?: string;
  qid?: string | null;
  aliases?: string[];
}

export interface Edge {
  id?: number;
  source: number;
  target: number;
  value?: number;
  relation: string;
  category?: string;
  directed?: boolean;
  sources?: EdgeSource[];
}

export interface SearchResult extends Node {
  degree: number;
}

export interface NeighborGraph {
  nodes: Node[];
  edges: Edge[];
  focalId: number;
  shown: number;
  total: number;
}

export interface PathRoute {
  nodes: number[];
  edges: number[];
  hops: number;
}

export interface Subgraph {
  from: number;
  to: number;
  paths: PathRoute[];
  nodes: Node[];
  edges: Edge[];
  suppressedHubs: Node[];
}

export interface GraphStats {
  persons: number;
  linkingEntitys: number;
  connections: number;
}

export interface EdgeSource {
  outlet: string;
  url: string;
  quote?: string | null;
  publishedDate?: string | null;
}

export interface ReviewItem {
  id: number;
  source: string;
  target: string;
  relation: string;
  category: string;
  confidence: string;
  verification: string;
  directed: boolean;
  sources: EdgeSource[];
}

export type ReviewAction = 'approve' | 'reject';
