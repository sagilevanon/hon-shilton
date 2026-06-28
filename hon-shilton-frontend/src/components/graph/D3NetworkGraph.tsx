import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Node, Edge } from '@/types';
import { CATEGORIES, categoryMeta, edgeKey, edgeLabel } from '@/lib/graph';

export interface RouteOverlay {
  nodeIds: Set<number>;
  edgeKeys: Set<string>;
  fromId: number;
  toId: number;
}

interface D3NetworkGraphProps {
  nodes: Node[];
  edges: Edge[];
  focalId: number | null;
  selectedId: number | null;
  selectedEdgeKey: string | null;
  expandable: Set<number>;
  remaining: Record<number, number>;
  route: RouteOverlay | null;
  onNodeClick: (node: Node) => void;
  onEdgeClick: (edge: Edge) => void;
  onExpandNode: (id: number) => void;
}

type SimNode = Node & { x: number; y: number; fx?: number | null; fy?: number | null };
type SimEdge = Omit<Edge, 'source' | 'target'> & { source: SimNode; target: SimNode };

const isPerson = (t: string) => t.toLowerCase() === 'person';
const linkWidth = (value?: number) => Math.min(8, 1.2 * Math.max(1, value ?? 1));
const endXY = (id: number | { id: number }) => (typeof id === 'object' ? id.id : id);
const colorOf = (e: { category?: string }) => categoryMeta(e.category).color;
// d3.forceLink mutates edge endpoints into node objects; normalize back to the
// numeric-endpoint Edge the rest of the app (keys, panel lookups) expects.
const toEdge = (e: SimEdge): Edge => ({ ...e, source: endXY(e.source), target: endXY(e.target) });
const keyOf = (e: SimEdge) => edgeKey(toEdge(e));

export default function D3NetworkGraph({
  nodes,
  edges,
  focalId,
  selectedId,
  selectedEdgeKey,
  expandable,
  remaining,
  route,
  onNodeClick,
  onEdgeClick,
  onExpandNode,
}: D3NetworkGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const posRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const radiusOf = (id: number) => (id === focalId ? 30 : 22);

    // Focus mode: when a connection overlay is active, light up its route
    // nodes/edges and dim everything else to context.
    const onRoute = (d: SimEdge) => !!route && route.edgeKeys.has(keyOf(d));
    const linkOpacity = (d: SimEdge) =>
      route ? (onRoute(d) ? 0.96 : 0.05) : keyOf(d) === selectedEdgeKey ? 0.98 : 0.42;
    const linkWidthOf = (d: SimEdge) =>
      linkWidth(d.value) + (route && onRoute(d) ? 2.5 : 0) + (keyOf(d) === selectedEdgeKey ? 2.5 : 0);
    const labelOpacity = (d: SimEdge) => (route && !onRoute(d) ? 0.05 : 1);
    const nodeOpacity = (d: SimNode) => (route && !route.nodeIds.has(d.id) ? 0.14 : 1);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const defs = svg.append('defs');
    const gradient = (id: string, a: string, b: string) => {
      const g = defs.append('radialGradient').attr('id', id).attr('cx', '35%').attr('cy', '30%').attr('r', '75%');
      g.append('stop').attr('offset', '0%').attr('stop-color', a);
      g.append('stop').attr('offset', '100%').attr('stop-color', b);
    };
    gradient('grad-person', '#F1E9D6', '#CBBD9A');
    gradient('grad-org', '#CDAC5E', '#8C6C2C');
    // One arrowhead per category so the head matches its edge color.
    CATEGORIES.forEach((c) => {
      defs
        .append('marker')
        .attr('id', `arrow-${c.id}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', c.color);
    });

    const root = svg.append('g');
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 3])
      .on('zoom', (e) => root.attr('transform', e.transform));
    svg.call(zoom as any).on('dblclick.zoom', null);

    const simNodes: SimNode[] = nodes.map((n) => ({ ...(n as SimNode) }));
    const simEdges: SimEdge[] = edges.map((e) => ({ ...e }) as unknown as SimEdge);

    const cx = width / 2;
    const cy = height / 2;
    // A re-render that only restyles (route highlight, selection) carries the same
    // node set, all already positioned — skip the expensive force re-settle then
    // and just repaint at cached coordinates. Re-layout only when a node is new.
    const needsLayout = simNodes.some((n) => !posRef.current.has(n.id));
    simNodes.forEach((n, i) => {
      const p = posRef.current.get(n.id);
      if (p) ((n.x = p.x), (n.y = p.y));
      else if (n.id === focalId) ((n.x = cx), (n.y = cy));
      else {
        const a = (i / simNodes.length) * 2 * Math.PI;
        n.x = cx + 180 * Math.cos(a);
        n.y = cy + 180 * Math.sin(a);
      }
    });

    const sim = d3
      .forceSimulation(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance((d) => 96 + 16 * Math.min(4, d.value ?? 1))
          .strength(0.45),
      )
      .force('charge', d3.forceManyBody().strength(-460))
      .force('center', d3.forceCenter(cx, cy))
      .force('collide', d3.forceCollide<SimNode>().radius((d) => radiusOf(d.id) + 26))
      .force('x', d3.forceX(cx).strength(0.045))
      .force('y', d3.forceY(cy).strength(0.045))
      .stop();
    if (needsLayout) sim.tick(320);
    simNodes.forEach((n) => posRef.current.set(n.id, { x: n.x, y: n.y }));

    const linkG = root.append('g');
    const linkSel = linkG
      .selectAll('line.hs-link')
      .data(simEdges)
      .join('line')
      .attr('class', 'hs-link')
      .attr('stroke', colorOf)
      .attr('stroke-opacity', linkOpacity)
      .attr('stroke-linecap', 'round')
      .attr('stroke-width', linkWidthOf)
      .attr('data-route', (d) => (onRoute(d) ? '1' : null))
      .style('filter', (d) => (route && onRoute(d) ? `drop-shadow(0 0 5px ${colorOf(d)})` : null))
      .attr('marker-end', (d) => (d.directed === false ? null : `url(#arrow-${categoryMeta(d.category).id})`));

    // Transparent fat lines give thin edges a clickable hit area.
    const hitSel = linkG
      .selectAll('line.hs-link-hit')
      .data(simEdges)
      .join('line')
      .attr('class', 'hs-link-hit')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 16)
      .style('cursor', 'pointer')
      .on('click', (e, d) => (e.stopPropagation(), onEdgeClick(toEdge(d))));

    const labelSel = root
      .append('g')
      .selectAll('text')
      .data(simEdges)
      .join('text')
      .attr('class', 'hs-link-label')
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none')
      .style('opacity', labelOpacity)
      .text((d) => edgeLabel(d));

    const nodeSel = root
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .attr('class', 'hs-node')
      .style('opacity', nodeOpacity)
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (_e, d) => ((d.fx = d.x), (d.fy = d.y)))
          .on('drag', (e, d) => ((d.fx = e.x), (d.fy = e.y), (d.x = e.x), (d.y = e.y), ticked()))
          .on('end', (_e, d) => ((d.fx = d.x), (d.fy = d.y))),
      )
      .on('click', (e, d) => (e.stopPropagation(), onNodeClick(d)))
      .on('mouseenter', (_e, d) => highlight(d.id))
      .on('mouseleave', clearHighlight);

    const focal = nodeSel.filter((d) => d.id === focalId);
    focal
      .append('circle')
      .attr('r', (d) => radiusOf(d.id) + 8)
      .attr('fill', 'none')
      .attr('stroke', 'var(--focal)')
      .attr('stroke-width', 1.5);
    [0, 90, 180, 270].forEach((deg) => {
      const a = (deg * Math.PI) / 180;
      focal
        .append('line')
        .attr('class', 'hs-reticle')
        .attr('x1', (d) => Math.cos(a) * (radiusOf(d.id) + 4))
        .attr('y1', (d) => Math.sin(a) * (radiusOf(d.id) + 4))
        .attr('x2', (d) => Math.cos(a) * (radiusOf(d.id) + 13))
        .attr('y2', (d) => Math.sin(a) * (radiusOf(d.id) + 13));
    });

    // Connection endpoints get distinct rings: origin (brass) → destination (stamp).
    if (route) {
      const endpointRing = (id: number, color: string) =>
        nodeSel
          .filter((d) => d.id === id)
          .append('circle')
          .attr('class', 'hs-endpoint')
          .attr('r', (d) => radiusOf(d.id) + 6)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 3);
      endpointRing(route.fromId, 'var(--brass)');
      endpointRing(route.toId, 'var(--stamp)');
    }

    nodeSel
      .append('circle')
      .attr('class', 'body')
      .attr('r', (d) => radiusOf(d.id))
      .attr('fill', (d) => `url(#${isPerson(d.type) ? 'grad-person' : 'grad-org'})`)
      .attr('stroke', (d) => (d.id === selectedId ? '#C2A14D' : 'rgba(8,16,14,0.65)'))
      .attr('stroke-width', (d) => (d.id === selectedId ? 4 : 1.5))
      .style('filter', 'drop-shadow(0 5px 11px rgba(0,0,0,0.55))');

    nodeSel
      .append('text')
      .attr('class', 'label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => radiusOf(d.id) + 17)
      .attr('font-size', (d) => (d.id === focalId ? 14.5 : 12.5))
      .text((d) => d.name);

    const expanders = nodeSel.filter((d) => expandable.has(d.id)).append('g').attr('class', 'hs-expander');
    expanders
      .append('circle')
      .attr('cx', (d) => radiusOf(d.id) * 0.72)
      .attr('cy', (d) => -radiusOf(d.id) * 0.72)
      .attr('r', 10)
      .attr('fill', '#C8102E')
      .attr('stroke', '#F4EFE4')
      .attr('stroke-width', 2);
    expanders
      .append('text')
      .attr('x', (d) => radiusOf(d.id) * 0.72)
      .attr('y', (d) => -radiusOf(d.id) * 0.72)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#fff')
      .attr('font-size', (d) => (remaining[d.id] > 0 ? 9 : 13))
      .attr('font-weight', 700)
      .style('pointer-events', 'none')
      .text((d) => (remaining[d.id] > 0 ? `+${remaining[d.id]}` : '+'));
    expanders.on('click', (e, d) => (e.stopPropagation(), onExpandNode(d.id)));

    function ticked() {
      linkSel
        .attr('x1', (d) => trim(d, 'x1'))
        .attr('y1', (d) => trim(d, 'y1'))
        .attr('x2', (d) => trim(d, 'x2'))
        .attr('y2', (d) => trim(d, 'y2'));
      hitSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      labelSel
        .attr('x', (d) => (d.source.x + d.target.x) / 2)
        .attr('y', (d) => (d.source.y + d.target.y) / 2);
      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
    }

    function trim(d: SimEdge, which: string): number {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L;
      const uy = dy / L;
      const sR = radiusOf(d.source.id) + 2;
      const tR = radiusOf(d.target.id) + (d.directed === false ? 2 : 9);
      if (which === 'x1') return d.source.x + ux * sR;
      if (which === 'y1') return d.source.y + uy * sR;
      if (which === 'x2') return d.target.x - ux * tR;
      return d.target.y - uy * tR;
    }

    function highlight(id: number) {
      const adj = new Set<number>([id]);
      simEdges.forEach((e) => {
        const s = endXY(e.source);
        const t = endXY(e.target);
        if (s === id) adj.add(t);
        if (t === id) adj.add(s);
      });
      nodeSel.style('opacity', (d) => (adj.has(d.id) ? 1 : 0.16));
      const touches = (e: SimEdge) => endXY(e.source) === id || endXY(e.target) === id;
      linkSel.style('stroke-opacity', (e) => (touches(e) ? 0.95 : 0.05));
      labelSel.style('opacity', (e) => (touches(e) ? 1 : 0.05));
    }
    function clearHighlight() {
      nodeSel.style('opacity', nodeOpacity);
      linkSel.style('stroke-opacity', linkOpacity);
      labelSel.style('opacity', labelOpacity);
    }

    ticked();

    const xs = simNodes.map((n) => n.x);
    const ys = simNodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const pad = 160;
    const scale = Math.max(0.3, Math.min(1.8, (width - pad * 2) / bw, (height - pad * 2) / bh));
    const t = d3.zoomIdentity
      .translate(width / 2 - scale * (minX + maxX) / 2, height / 2 - scale * (minY + maxY) / 2)
      .scale(scale);
    svg.transition().duration(500).call(zoom.transform as any, t);

    return () => void sim.stop();
  }, [nodes, edges, focalId, selectedId, selectedEdgeKey, expandable, remaining, route, onNodeClick, onEdgeClick, onExpandNode]);

  return <svg ref={svgRef} className="h-full w-full" style={{ display: 'block' }} />;
}
