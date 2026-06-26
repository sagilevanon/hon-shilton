import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { ClipboardCheck, Loader2, Spline } from 'lucide-react';
import { ConfigAPI, NeighborAPI } from '@/services/api';
import { Node, Edge, SearchResult, NeighborGraph } from '@/types';
import { CATEGORIES, edgeKey } from '@/lib/graph';
import D3NetworkGraph from '../components/graph/D3NetworkGraph';
import NodeDetailsPanel from '../components/graph/NodeDetailsPanel';
import EdgeDetailsPanel from '../components/graph/EdgeDetailsPanel';
import Landing from '../components/explorer/Landing';
import SearchBox from '../components/explorer/SearchBox';
import CategoryFilter from '../components/explorer/CategoryFilter';

const STEP = 8;
const ALL_CATEGORIES = new Set(CATEGORIES.map((c) => c.key));

interface Graph {
  nodes: Node[];
  edges: Edge[];
}
interface Meta {
  shown: number;
  total: number;
}

export default function NetworkGraphPage() {
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [focalId, setFocalId] = useState<number | null>(null);
  const [meta, setMeta] = useState<Map<number, Meta>>(new Map());
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [active, setActive] = useState<Set<string>>(ALL_CATEGORIES);
  const [loading, setLoading] = useState(false);
  const [reviewGate, setReviewGate] = useState(false);
  const [session, setSession] = useState(0);
  const metaRef = useRef(meta);
  metaRef.current = meta;

  useEffect(() => {
    ConfigAPI.get()
      .then((c) => setReviewGate(c.reviewGate))
      .catch(() => undefined);
  }, []);

  const merge = useCallback((g: NeighborGraph) => {
    setGraph((prev) => {
      const nodeIds = new Set(prev.nodes.map((n) => n.id));
      const seen = new Set(prev.edges.map(edgeKey));
      return {
        nodes: [...prev.nodes, ...g.nodes.filter((n) => !nodeIds.has(n.id))],
        edges: [...prev.edges, ...g.edges.filter((e) => !seen.has(edgeKey(e)))],
      };
    });
    setMeta((prev) => new Map(prev).set(g.focalId, { shown: g.shown, total: g.total }));
  }, []);

  const clearSelection = useCallback(() => (setSelectedNode(null), setSelectedEdge(null)), []);

  const selectEntity = useCallback(async (r: SearchResult) => {
    setLoading(true);
    try {
      const g = await NeighborAPI.get(r.id);
      setGraph({ nodes: g.nodes, edges: g.edges });
      setMeta(new Map([[g.focalId, { shown: g.shown, total: g.total }]]));
      setFocalId(r.id);
      setSelectedNode(null);
      setSelectedEdge(null);
      setActive(ALL_CATEGORIES);
      setSession((s) => s + 1);
    } finally {
      setLoading(false);
    }
  }, []);

  const expandNode = useCallback(
    async (id: number) => {
      const m = metaRef.current.get(id);
      const limit = m ? m.shown + STEP : undefined;
      setLoading(true);
      try {
        merge(await NeighborAPI.get(id, limit));
      } finally {
        setLoading(false);
      }
    },
    [merge],
  );

  const reset = useCallback(() => {
    setGraph({ nodes: [], edges: [] });
    setMeta(new Map());
    setFocalId(null);
    clearSelection();
  }, [clearSelection]);

  const onNodeClick = useCallback((n: Node) => (setSelectedEdge(null), setSelectedNode(n)), []);
  const onEdgeClick = useCallback((e: Edge) => (setSelectedNode(null), setSelectedEdge(e)), []);
  const toggleCategory = useCallback(
    (key: string) =>
      setActive((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      }),
    [],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of graph.edges) c[e.category ?? 'אחר'] = (c[e.category ?? 'אחר'] ?? 0) + 1;
    return c;
  }, [graph.edges]);

  // Category filter: drop hidden-category edges, then any node left unconnected
  // (the focal node always stays so the view never empties out under it).
  const view = useMemo(() => {
    if (active.size === CATEGORIES.length) return graph;
    const edges = graph.edges.filter((e) => active.has(e.category ?? 'אחר'));
    const keep = new Set<number>(focalId === null ? [] : [focalId]);
    for (const e of edges) (keep.add(e.source), keep.add(e.target));
    return { edges, nodes: graph.nodes.filter((n) => keep.has(n.id)) };
  }, [graph, active, focalId]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const expandable = useMemo(() => {
    const s = new Set<number>();
    for (const n of view.nodes) {
      const m = meta.get(n.id);
      if (!m || m.total > m.shown) s.add(n.id);
    }
    return s;
  }, [view.nodes, meta]);

  const remaining = useMemo(() => {
    const r: Record<number, number> = {};
    for (const [id, m] of meta) if (m.total > m.shown) r[id] = m.total - m.shown;
    return r;
  }, [meta]);

  if (focalId === null) return <Landing onSelect={selectEntity} />;

  const persons = view.nodes.filter((n) => n.type.toLowerCase() === 'person').length;
  const orgs = view.nodes.length - persons;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div className="hs-canvas absolute inset-0" onClick={clearSelection}>
        <D3NetworkGraph
          key={session}
          nodes={view.nodes}
          edges={view.edges}
          focalId={focalId}
          selectedId={selectedNode?.id ?? null}
          selectedEdgeKey={selectedEdge ? edgeKey(selectedEdge) : null}
          expandable={expandable}
          remaining={remaining}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onExpandNode={expandNode}
        />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 px-4 pt-4">
        <div className="hs-chrome hs-rtl pointer-events-auto flex items-center gap-3 rounded-2xl px-3.5 py-2.5">
          <button onClick={reset} className="flex items-center gap-2.5 pr-1 transition-opacity hover:opacity-80">
            <Spline className="h-5 w-5" style={{ color: 'var(--stamp)' }} />
            <span className="hs-display text-lg font-bold leading-none" style={{ color: 'var(--bone)' }}>
              הון־שלטון
            </span>
            <span
              className="hs-mono hidden text-[10px] uppercase tracking-[0.18em] sm:inline"
              style={{ color: 'var(--bone-soft)' }}
            >
              Relationship Index
            </span>
          </button>

          <div className="h-6 w-px" style={{ background: 'var(--brass-line)' }} />

          <div className="w-full max-w-sm">
            <SearchBox onSelect={selectEntity} placeholder="חיפוש ישות אחרת…" />
          </div>

          <div className="ml-auto hidden items-center gap-3.5 md:flex">
            <Stat label="אנשים" value={persons} dot="var(--person)" />
            <Stat label="ארגונים" value={orgs} dot="var(--org)" />
            <Stat label="קשרים" value={view.edges.length} dot="var(--brass)" />
          </div>

          {reviewGate && (
            <Link
              to="/review"
              className="flex items-center rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
              style={{ color: 'var(--bone-soft)' }}
            >
              <ClipboardCheck className="h-[18px] w-[18px]" />
            </Link>
          )}
        </div>
      </header>

      {loading && (
        <div
          className="hs-chrome hs-rtl absolute left-1/2 top-[4.75rem] z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm"
          style={{ color: 'var(--bone)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--brass)' }} />
          טוען קשרים…
        </div>
      )}

      <CategoryFilter active={active} counts={counts} onToggle={toggleCategory} />

      <AnimatePresence>
        {selectedNode && (
          <NodeDetailsPanel node={selectedNode} onClose={clearSelection} onExpand={expandNode} />
        )}
        {selectedEdge && (
          <EdgeDetailsPanel
            edge={selectedEdge}
            sourceName={nodeById.get(selectedEdge.source)?.name ?? '—'}
            targetName={nodeById.get(selectedEdge.target)?.name ?? '—'}
            onClose={clearSelection}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--bone-soft)' }}>
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
      <b className="hs-mono text-[13px] font-semibold" style={{ color: 'var(--bone)' }}>
        {value}
      </b>
      {label}
    </span>
  );
}
