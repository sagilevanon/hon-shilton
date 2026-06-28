// Connection finder (Phase 8) — pure path-set logic, no SQL.
// Given injected graph primitives (single-best-path + degrees), assemble up to K
// vertex-disjoint shortest paths between two entities: find the best path, ban
// its intermediate nodes, repeat. Major hubs are excluded by default (a relative
// top-percentile degree cutoff over intermediaries only) with an override; a
// manual exclude list layers on top. The two endpoints are always allowed.

import type { RawPath } from './graphStore.js';

export const K = 5;
export const HUB_PERCENTILE = 0.97;

export interface PathDeps {
  shortestPath(from: number, to: number, exclude: number[], maxHops: number): RawPath | null;
  degrees(): Map<number, number>;
}

export interface SubgraphRequest {
  from: number;
  to: number;
  maxHops: number;
  exclude: number[];
  includeHubs: boolean;
}

export interface SubgraphPaths {
  paths: Array<{ nodes: number[]; edges: number[]; hops: number }>;
  nodeIds: number[];
  edgeIds: number[];
  suppressedHubIds: number[];
}

// The degree at which an entity counts as a "major hub": the value of the k-th
// most-connected entity for the top (1 - percentile) fraction. Nodes whose degree
// is >= this are hubs (ties at the boundary are all-in, so the cutoff is stable).
// On a uniform/near-uniform graph the percentile collapses to the minimum degree,
// which would brand every node a hub — a hub must stand out, so when the cutoff
// does not exceed the floor we report no hubs (Infinity) instead.
export function hubThreshold(degrees: number[], percentile = HUB_PERCENTILE): number {
  if (degrees.length === 0) return Infinity;
  const desc = [...degrees].sort((a, b) => b - a);
  const k = Math.max(1, Math.ceil((1 - percentile) * desc.length));
  const cutoff = desc[k - 1];
  const floor = desc[desc.length - 1];
  return cutoff > floor ? cutoff : Infinity;
}

const unique = (xs: number[]): number[] => [...new Set(xs)];

export function findPaths(deps: PathDeps, req: SubgraphRequest): SubgraphPaths {
  const { from, to, maxHops, exclude, includeHubs } = req;

  const degrees = deps.degrees();
  const threshold = hubThreshold([...degrees.values()]);
  const hubIds = includeHubs
    ? []
    : [...degrees]
        .filter(([id, d]) => d >= threshold && id !== from && id !== to)
        .map(([id]) => id);

  const banned = new Set<number>([...exclude, ...hubIds]);
  banned.delete(from);
  banned.delete(to);

  const paths: SubgraphPaths['paths'] = [];
  const usedIntermediates = new Set<number>();
  for (let k = 0; k < K; k++) {
    const p = deps.shortestPath(from, to, [...banned, ...usedIntermediates], maxHops);
    if (!p) break;
    paths.push({ nodes: p.nodeIds, edges: p.edgeIds, hops: p.hops });
    const intermediates = p.nodeIds.slice(1, -1);
    if (intermediates.length === 0) break; // a direct edge: no disjoint alternative
    for (const id of intermediates) usedIntermediates.add(id);
  }

  return {
    paths,
    nodeIds: unique(paths.flatMap((p) => p.nodes)),
    edgeIds: unique(paths.flatMap((p) => p.edges)),
    suppressedHubIds: hubIds,
  };
}
