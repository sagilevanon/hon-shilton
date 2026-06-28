import { useCallback, useEffect, useRef, useState } from 'react';
import { SubgraphAPI } from '@/services/api';
import { Node, Edge, Subgraph } from '@/types';

// Connection-finder state (Phase 8). Owns the "trace connection" lifecycle:
// arm an origin → pick a destination (by click or by typing a hidden name) →
// fetch /subgraph → fold the route's nodes/edges into the explorer graph. The
// hop depth / hub override / manual exclude params re-run the search live. Only
// one connection is active at a time; clearing keeps the accumulated graph.
const DEFAULT_HOPS = 3;
const DEBOUNCE_MS = 200;

export interface ConnectionParams {
  maxHops: number;
  includeHubs: boolean;
  exclude: number[];
}

const INITIAL_PARAMS: ConnectionParams = { maxHops: DEFAULT_HOPS, includeHubs: false, exclude: [] };

export interface Connection {
  armed: boolean;
  fromId: number | null;
  toId: number | null;
  subgraph: Subgraph | null;
  params: ConnectionParams;
  loading: boolean;
  error: boolean;
  active: boolean;
  noPath: boolean;
  armTrace: (fromId: number) => void;
  cancelArm: () => void;
  pickTarget: (toId: number) => void;
  setHops: (n: number) => void;
  toggleHubs: () => void;
  addExclude: (id: number) => void;
  removeExclude: (id: number) => void;
  clear: () => void;
}

export function useConnection(onMerge: (g: { nodes: Node[]; edges: Edge[] }) => void): Connection {
  const [armed, setArmed] = useState(false);
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [subgraph, setSubgraph] = useState<Subgraph | null>(null);
  const [params, setParams] = useState<ConnectionParams>(INITIAL_PARAMS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const mergeRef = useRef(onMerge);
  mergeRef.current = onMerge;

  // Fetch the route whenever endpoints/params change. Debounced + abortable so a
  // hop-slider drag (one change per intermediate value) coalesces into a single
  // request and superseded ones are cancelled rather than racing to land stale.
  useEffect(() => {
    if (fromId === null || toId === null) return;
    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(false);
      SubgraphAPI.get(fromId, toId, params, controller.signal)
        .then((s) => {
          if (!live) return;
          setSubgraph(s);
          mergeRef.current({ nodes: s.nodes, edges: s.edges });
        })
        .catch((e: unknown) => {
          if (live && (e as Error)?.name !== 'AbortError') {
            setSubgraph(null);
            setError(true);
          }
        })
        .finally(() => live && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [fromId, toId, params]);

  const armTrace = useCallback((id: number) => {
    setFromId(id);
    setToId(null);
    setSubgraph(null);
    setError(false);
    setParams(INITIAL_PARAMS);
    setArmed(true);
  }, []);

  const cancelArm = useCallback(() => {
    setArmed(false);
    if (toId === null) setFromId(null);
  }, [toId]);

  // Re-picking the origin is a no-op: stay armed so the user can still choose a
  // real destination rather than silently dropping out of arm mode.
  const pickTarget = useCallback(
    (id: number) => {
      if (id === fromId) return;
      setToId(id);
      setArmed(false);
    },
    [fromId],
  );

  const setHops = useCallback((n: number) => setParams((p) => ({ ...p, maxHops: n })), []);
  const toggleHubs = useCallback(() => setParams((p) => ({ ...p, includeHubs: !p.includeHubs })), []);
  const addExclude = useCallback(
    (id: number) => setParams((p) => (p.exclude.includes(id) ? p : { ...p, exclude: [...p.exclude, id] })),
    [],
  );
  const removeExclude = useCallback(
    (id: number) => setParams((p) => ({ ...p, exclude: p.exclude.filter((x) => x !== id) })),
    [],
  );

  const clear = useCallback(() => {
    setArmed(false);
    setFromId(null);
    setToId(null);
    setSubgraph(null);
    setError(false);
    setParams(INITIAL_PARAMS);
  }, []);

  const active = subgraph !== null || (fromId !== null && toId !== null);
  const noPath = subgraph !== null && subgraph.paths.length === 0;

  return {
    armed,
    fromId,
    toId,
    subgraph,
    params,
    loading,
    error,
    active,
    noPath,
    armTrace,
    cancelArm,
    pickTarget,
    setHops,
    toggleHubs,
    addExclude,
    removeExclude,
    clear,
  };
}
