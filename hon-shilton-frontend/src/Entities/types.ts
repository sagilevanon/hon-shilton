export interface Node {
  node_id: string;
  name: string;
  type: 'person' | 'linkingEntity';
  description?: string;
  image_url?: string;
  position_x?: number;
  position_y?: number;
}

export interface Edge {
  source_id: string;
  target_id: string;
  relationship: string;
  strength?: number;
}
