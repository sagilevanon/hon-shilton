import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Node, Edge } from '@/types';

interface D3NetworkGraphProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (node: Node) => void;
  hoveredNode: string | null;
  setHoveredNode: (nodeId: string | null) => void;
}

const D3NetworkGraph: React.FC<D3NetworkGraphProps> = ({
  nodes,
  edges,
  onNodeClick,
  hoveredNode,
  setHoveredNode,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<d3.SimulationNodeDatum, undefined>>();

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    const { width, height } = containerRef.current.getBoundingClientRect();
    
    // Clear previous SVG content
    d3.select(svgRef.current).selectAll('*').remove();

    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'background-color: #f9fafb');

    // Create a group for zoom/pan
    const g = svg.append('g');

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom as any);

    // Create the simulation with adjusted forces
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(edges)
        .id((d: any) => d.id)
        .distance(150)
        .strength(0.01) // Reduce the strength of the links
      )
      .force('charge', d3.forceManyBody()
        .strength(-200) // Reduce repulsion force
        .distanceMax(100) // Limit the maximum distance for repulsion
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(60))
      .alphaDecay(0.05) // Slower decay for smoother transitions
      .velocityDecay(0.6); // More friction to slow down movement

    simulationRef.current = simulation;

    // Create links (edges)
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .enter().append('line')
      .attr('stroke', '#94a3b8')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', 2);

    // Create link labels
    const linkText = g.append('g')
      .selectAll('text')
      .data(edges)
      .enter().append('text')
      .attr('font-size', 10)
      .attr('fill', '#4b5563')
      .text(d => d.relation);

    // Create nodes group
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter().append('g')
      .call(d3.drag<SVGGElement, Node>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended)
      );

    // Add circles for nodes
    node.append('circle')
      .attr('r', 20)
      .attr('fill', d => d.type.toLowerCase() === 'person' ? '#3b82f6' : '#ef4444')
      .on('click', (event, d) => {
        event.stopPropagation();
        onNodeClick(d);
      })
      .on('mouseover', (event, d) => setHoveredNode(d.id.toString()))
      .on('mouseout', () => setHoveredNode(null));

    // Add node images or initials
    node.each(function(d) {
      const nodeGroup = d3.select(this);
      
      if (d.image) {
        nodeGroup.append('image')
          .attr('x', -20)
          .attr('y', -20)
          .attr('width', 40)
          .attr('height', 40)
          .attr('xlink:href', d.image)
          .attr('clip-path', 'circle(20px at center)')
          .on('click', (event) => {
            event.stopPropagation();
            onNodeClick(d);
          });
      } else {
        nodeGroup.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', 5)
          .attr('fill', 'white')
          .attr('font-size', 12)
          .attr('font-weight', '500')
          .text(d.name.charAt(0).toUpperCase());
      }

      // Add node name
      nodeGroup.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', 30)
        .attr('fill', '#374151')
        .attr('font-size', 12)
        .attr('font-weight', '500')
        .text(d.name);
    });

    // Update positions on each tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as any).x || 0)
        .attr('y1', d => (d.source as any).y || 0)
        .attr('x2', d => (d.target as any).x || 0)
        .attr('y2', d => (d.target as any).y || 0);

      linkText
        .attr('x', d => ((d.source as any).x + (d.target as any).x) / 2)
        .attr('y', d => ((d.source as any).y + (d.target as any).y) / 2);

      node
        .attr('transform', d => `translate(${(d as any).x},${(d as any).y})`);
    });

    // Drag functions
    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.1).restart();
      // Fix the node's position
      d.fx = d.x;
      d.fy = d.y;
      // Reduce the simulation's alpha to minimize movement of other nodes
      simulation.alpha(0.1);
    }

    function dragged(event: any, d: any) {
      // Update the fixed position of the node
      d.fx = event.x;
      d.fy = event.y;
      // Keep alpha low to prevent other nodes from moving much
      simulation.alpha(0.1);
    }

    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      // Keep the node at the dragged position
      d.fx = event.x;
      d.fy = event.y;
      // Let the simulation settle
      simulation.alpha(0.5).restart();
    }

    // Handle hover effects
    if (hoveredNode) {
      link
        .style('opacity', d => 
          (d.source as any).id.toString() === hoveredNode || 
          (d.target as any).id.toString() === hoveredNode ? 1 : 0.3
        );
      
      node
        .style('opacity', d => 
          d.id.toString() === hoveredNode || 
          edges.some(e => 
            (e.source === d.id || e.target === d.id) && 
            (e.source.toString() === hoveredNode || e.target.toString() === hoveredNode)
          ) ? 1 : 0.3
        );
    } else {
      link.style('opacity', 0.7);
      node.style('opacity', 1);
    }

    // Clean up on unmount
    return () => {
      simulation.stop();
    };
  }, [nodes, edges, hoveredNode]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && svgRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        d3.select(svgRef.current)
          .attr('width', width)
          .attr('height', height);
        
        // Restart simulation to recenter
        if (simulationRef.current) {
          simulationRef.current.force('center', d3.forceCenter(width / 2, height / 2));
          simulationRef.current.alpha(1).restart();
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
};

export default D3NetworkGraph;
