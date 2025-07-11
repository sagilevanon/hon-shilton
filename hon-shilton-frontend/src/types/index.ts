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
  relation: string;
}

export interface GraphStats {
  persons: number;
  linkingEntitys: number;
  connections: number;
}
