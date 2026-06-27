// Pure graph diff: compare a candidate graph against the baseline (existing
// records). Entities keyed by qid (else canonical name); edges keyed by the
// entity-NAME pair + relation (ids differ across DBs), undirected pairs sorted
// so direction is irrelevant. Every divergent edge carries its source article
// url + quote so divergences can be judged, not just counted.

import type { GraphNode, GraphEdge } from '../db.js';
import { normalize } from '../normalize.js';

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DiffOptions {
  normalizeKeys?: boolean;
}

export interface EdgeRef {
  source: string;
  target: string;
  relation: string;
  url?: string;
  quote?: string;
}

export interface EdgeChange extends EdgeRef {
  field: 'category' | 'confidence' | 'directed';
  base: string;
  candidate: string;
}

export interface GraphDiff {
  entities: { onlyBase: string[]; onlyCandidate: string[]; common: number };
  edges: { dropped: EdgeRef[]; added: EdgeRef[]; changed: EdgeChange[]; common: number };
}

type KeyFn = (s: string) => string;

const entityKey = (n: GraphNode, key: KeyFn): string => n.qid ?? key(n.name);

function nameMap(nodes: GraphNode[]): Map<number, string> {
  return new Map(nodes.map((n) => [n.id, n.name]));
}

function edgeKey(e: GraphEdge, nameOf: Map<number, string>, key: KeyFn): string {
  const s = key(nameOf.get(e.source) ?? String(e.source));
  const t = key(nameOf.get(e.target) ?? String(e.target));
  const [a, b] = e.directed ? [s, t] : [s, t].sort();
  return `${e.directed ? 'D' : 'U'}${a}${key(e.relation)}${b}`;
}

function edgeRef(e: GraphEdge, nameOf: Map<number, string>): EdgeRef {
  const src = e.sources?.[0];
  return {
    source: nameOf.get(e.source) ?? String(e.source),
    target: nameOf.get(e.target) ?? String(e.target),
    relation: e.relation,
    url: src?.url,
    quote: src?.quote,
  };
}

export function diffGraphs(base: GraphData, candidate: GraphData, opts: DiffOptions = {}): GraphDiff {
  const key: KeyFn = opts.normalizeKeys ? normalize : (s) => s;
  const baseEntities = new Map(base.nodes.map((n) => [entityKey(n, key), n.name]));
  const candEntities = new Map(candidate.nodes.map((n) => [entityKey(n, key), n.name]));
  const onlyBase = [...baseEntities].filter(([k]) => !candEntities.has(k)).map(([, name]) => name);
  const onlyCandidate = [...candEntities].filter(([k]) => !baseEntities.has(k)).map(([, name]) => name);
  const commonEntities = [...baseEntities.keys()].filter((k) => candEntities.has(k)).length;

  const baseNames = nameMap(base.nodes);
  const candNames = nameMap(candidate.nodes);
  const baseEdges = new Map(base.edges.map((e) => [edgeKey(e, baseNames, key), e]));
  const candEdges = new Map(candidate.edges.map((e) => [edgeKey(e, candNames, key), e]));

  const dropped: EdgeRef[] = [];
  const changed: EdgeChange[] = [];
  let common = 0;
  for (const [key, e] of baseEdges) {
    const match = candEdges.get(key);
    if (!match) {
      dropped.push(edgeRef(e, baseNames));
      continue;
    }
    common++;
    changed.push(...edgeChanges(e, match, baseNames));
  }
  const added = [...candEdges].filter(([k]) => !baseEdges.has(k)).map(([, e]) => edgeRef(e, candNames));

  return {
    entities: { onlyBase, onlyCandidate, common: commonEntities },
    edges: { dropped, added, changed, common },
  };
}

function edgeChanges(base: GraphEdge, cand: GraphEdge, nameOf: Map<number, string>): EdgeChange[] {
  const ref = edgeRef(base, nameOf);
  const fields: EdgeChange['field'][] = ['category', 'confidence', 'directed'];
  return fields
    .filter((f) => String(base[f]) !== String(cand[f]))
    .map((f) => ({ ...ref, field: f, base: String(base[f]), candidate: String(cand[f]) }));
}
