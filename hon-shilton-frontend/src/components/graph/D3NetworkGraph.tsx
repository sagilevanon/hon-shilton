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

    // Create the simulation with basic forces
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(edges)
        .id((d: any) => d.id)
        .distance(100)
      )
      .force('charge', d3.forceManyBody().strength(-100))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(60))
      .alphaDecay(0.05)
      .velocityDecay(0.4);

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

    // Create nodes group with hover events
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter().append('g')
      .attr('class', 'node-group')
      .style('pointer-events', 'all')
      .call(d3.drag<SVGGElement, Node>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended)
      )
      .on('mouseover', function(event, d) {
        setHoveredNode(d.id.toString());
      })
      .on('mouseout', function() {
        setHoveredNode(null);
      });

    // Add circles for nodes
    node.append('circle')
      .attr('r', 20)
      .attr('fill', d => d.type.toLowerCase() === 'person' ? '#3b82f6' : '#ef4444')
      .on('click', function(event, d) {
        event.stopPropagation();
        onNodeClick(d);
      });

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

    // Drag behavior with offset handling
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    
    function dragstarted(event: any, d: any) {
      // Calculate the offset between mouse and node center
      dragOffsetX = d.x - event.x;
      dragOffsetY = d.y - event.y;
      
      // Fix the node's position
      d.fx = d.x;
      d.fy = d.y;
      
      // Lightly activate the simulation
      if (!event.active) simulation.alphaTarget(0.1).restart();
    }

    function dragged(event: any, d: any) {
      // Apply the offset to keep the node under the cursor
      d.fx = event.x + dragOffsetX;
      d.fy = event.y + dragOffsetY;
    }

    function dragended(event: any, d: any) {
      // Keep the node at its current position
      d.fx = d.x;
      d.fy = d.y;
      
      // Stop the simulation
      if (!event.active) simulation.alphaTarget(0);
    }

      // Handle hover effects - only update styles, not positions
    if (hoveredNode) {
      // Ensure simulation is completely stopped during hover
      simulation.alphaTarget(0);
      simulation.alpha(0);
      // Fix all nodes in their current positions
      simulation.nodes().forEach(node => {
        if (!node.fx) node.fx = node.x;
        if (!node.fy) node.fy = node.y;
      });
      
      // Highlight links connected to the hovered node
      link
        .style('opacity', d => {
          const sourceId = (d.source as any)?.id?.toString() || (d.source as any)?.toString();
          const targetId = (d.target as any)?.id?.toString() || (d.target as any)?.toString();
          return (sourceId === hoveredNode || targetId === hoveredNode) ? 1 : 0.3;
        });
      
      // Highlight the hovered node and its direct connections
      node
        .style('opacity', d => {
          const nodeId = d.id.toString();
          if (nodeId === hoveredNode) return 1;
          
          // Check if this node is connected to the hovered node
          return edges.some(e => {
            const sourceId = (e.source as any)?.id?.toString() || e.source?.toString();
            const targetId = (e.target as any)?.id?.toString() || e.target?.toString();
            return (sourceId === hoveredNode && targetId === nodeId) || 
                   (targetId === hoveredNode && sourceId === nodeId);
          }) ? 1 : 0.3;
        });
    } else {
      // Keep simulation stopped when not hovering
      simulation.alphaTarget(0);
      
      // Reset all opacities
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
