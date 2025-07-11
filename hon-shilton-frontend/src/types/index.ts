export interface Node {
  id: number;
  name: string;
  group: number;
  type: string;
  image?: string;
}

export interface Edge {
  source: number;
  target: number;
  value?: number;
}

export interface GraphStats {
  persons: number;
  connectors: number;
  connections: number;
}
