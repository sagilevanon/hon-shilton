import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findPaths, hubThreshold, HUB_PERCENTILE } from '../server/paths.js';
import type { RawPath } from '../server/graphStore.js';

// Undirected test graph (mirrors the /subgraph integration DB):
//   A=1 B=2 C=3 D=4 E=5 F=6 HUB=7
//   A-B-C-D (3-hop chain), A-E-D (2-hop alt), A-HUB-D (2-hop via hub).
//   HUB also links B,C,E,F, so it is the lone high-degree hub; F hangs off HUB only.
const EDGES: Array<[number, number, number]> = [
  [1, 1, 2], [2, 2, 3], [3, 3, 4],
  [4, 1, 5], [5, 5, 4],
  [6, 1, 7], [7, 7, 4],
  [8, 7, 2], [9, 7, 3], [10, 7, 5], [11, 7, 6],
];

function degrees(): Map<number, number> {
  const d = new Map<number, number>();
  for (const [, a, b] of EDGES) {
    d.set(a, (d.get(a) ?? 0) + 1);
    d.set(b, (d.get(b) ?? 0) + 1);
  }
  return d;
}

// Deterministic BFS single-shortest-path (fewest hops) avoiding an exclude set —
// stands in for the recursive-CTE shortestPath so findPaths' K-loop is unit-tested.
function shortestPath(from: number, to: number, exclude: number[], maxHops: number): RawPath | null {
  const blocked = new Set(exclude);
  const adj = new Map<number, Array<{ node: number; edge: number }>>();
  for (const [id, a, b] of EDGES) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ node: b, edge: id });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ node: a, edge: id });
  }
  const queue: Array<{ nodeIds: number[]; edgeIds: number[] }> = [{ nodeIds: [from], edgeIds: [] }];
  const seen = new Set<number>([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const last = path.nodeIds[path.nodeIds.length - 1];
    if (last === to) return { nodeIds: path.nodeIds, edgeIds: path.edgeIds, hops: path.edgeIds.length };
    if (path.edgeIds.length >= maxHops) continue;
    for (const { node, edge } of [...(adj.get(last) ?? [])].sort((x, y) => x.edge - y.edge)) {
      if (seen.has(node) || (blocked.has(node) && node !== to)) continue;
      seen.add(node);
      queue.push({ nodeIds: [...path.nodeIds, node], edgeIds: [...path.edgeIds, edge] });
    }
  }
  return null;
}

const deps = { shortestPath, degrees };
const req = (over: Partial<Parameters<typeof findPaths>[1]>) => ({
  from: 1,
  to: 4,
  maxHops: 6,
  exclude: [] as number[],
  includeHubs: false,
  ...over,
});

describe('paths.ts — connection finder logic', () => {
  describe('hubThreshold', () => {
    it('marks the top fraction by degree; ties at the boundary are all-in', () => {
      assert.equal(hubThreshold([3, 3, 3, 3, 3, 1, 6]), 6); // lone deg-6 hub
      assert.equal(hubThreshold([]), Infinity);
      // top (1 - 0.5) = 50% of 4 → k=2, the 2nd-highest degree is the cutoff
      assert.equal(hubThreshold([1, 2, 9, 10], 0.5), 9);
    });
    it('exposes a percentile in (0,1)', () => assert.ok(HUB_PERCENTILE > 0 && HUB_PERCENTILE < 1));
  });

  describe('findPaths', () => {
    it('returns vertex-disjoint shortest paths, shortest first, hubs excluded by default', () => {
      const r = findPaths(deps, req({}));
      assert.deepEqual(r.paths.map((p) => p.nodes), [
        [1, 5, 4], // A→E→D (2 hops)
        [1, 2, 3, 4], // A→B→C→D (3 hops), disjoint from E
      ]);
      assert.deepEqual(r.paths.map((p) => p.hops), [2, 3], 'shortest first');
      assert.deepEqual(r.suppressedHubIds, [7]);
      assert.ok(!r.nodeIds.includes(7), 'the hub is never routed through by default');
      assert.deepEqual([...r.nodeIds].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    });

    it('include-hubs override restores routes through the hub', () => {
      const r = findPaths(deps, req({ includeHubs: true }));
      assert.deepEqual(r.suppressedHubIds, []);
      assert.ok(r.nodeIds.includes(7), 'the hub now carries a route');
    });

    it('honors a manual exclude list', () => {
      const r = findPaths(deps, req({ exclude: [5] }));
      assert.deepEqual(r.paths.map((p) => p.nodes), [[1, 2, 3, 4]]);
      assert.ok(!r.nodeIds.includes(5), 'the excluded node is gone');
    });

    it('a successful negative answer: no connection within the graph returns no paths', () => {
      const r = findPaths(deps, req({ to: 6 })); // F reachable only via the excluded hub
      assert.deepEqual(r.paths, []);
      assert.deepEqual(r.nodeIds, []);
      assert.deepEqual(r.suppressedHubIds, [7], 'and it says which hub it suppressed');
    });

    it('the hop cap can starve an otherwise-reachable target', () => {
      const r = findPaths(deps, req({ exclude: [5], maxHops: 2 })); // only the 3-hop chain remains
      assert.deepEqual(r.paths, []);
    });

    it('a direct edge yields exactly one route (no duplicate disjoint copies)', () => {
      const r = findPaths(deps, req({ to: 2 }));
      assert.deepEqual(r.paths.map((p) => p.nodes), [[1, 2]]);
    });
  });
});
