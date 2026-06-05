import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Node, Edge } from '@/types';
import { Plus } from 'lucide-react';

interface ExpandableNode {
  nodeId: string | number;
  expanded: boolean;
}

interface D3NetworkGraphProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (node: Node) => void;
  hoveredNode: string | null;
  setHoveredNode: (nodeId: string | null) => void;
  expandableNodes?: ExpandableNode[];
  onExpandNode?: (nodeId: string | number) => void;
}

const D3NetworkGraph: React.FC<D3NetworkGraphProps> = ({
  nodes,
  edges,
  onNodeClick,
  hoveredNode,
  setHoveredNode,
  expandableNodes = [],
  onExpandNode,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<d3.SimulationNodeDatum, undefined>>();

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    // Use window dimensions for full viewport
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Clear previous SVG content
    d3.select(svgRef.current).selectAll('*').remove();

    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('background-color', 'transparent');

    // Create a group for zoom/pan
    const g = svg.append('g');

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom as any);

    // For small graphs with one central node and its connections,
    // we'll use a simple radial layout with fixed positions
    const setupInitialPositions = () => {
      // Position all nodes initially at the center to avoid teleporting
      nodes.forEach(node => {
        (node as any).x = width / 2;
        (node as any).y = height / 2;
      });
      
      // Find the central node (usually id=1)
      const centralNodeId = 1;
      const centralNode = nodes.find(n => n.id === centralNodeId);
      
      if (centralNode) {
        // Position central node in the middle
        (centralNode as any).x = width / 2;
        (centralNode as any).y = height / 2;
      }
      
      // Get all nodes except the central one
      const connectedNodes = nodes.filter(n => n.id !== centralNodeId);
      
      // Position connected nodes in a circle around the central node
      if (connectedNodes.length > 0) {
        const angleStep = (2 * Math.PI) / connectedNodes.length;
        const radius = 150; // Distance from central node
        
        connectedNodes.forEach((node, i) => {
          const angle = i * angleStep;
          // Position in a circle around central node
          (node as any).x = width / 2 + radius * Math.cos(angle);
          (node as any).y = height / 2 + radius * Math.sin(angle);
        });
      }
    };
    
    // Apply initial positions
    setupInitialPositions();
    
    // Create a minimal simulation that just applies the initial positions
    // without causing much additional movement
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      // Use a very weak link force just to maintain structure
      .force('link', d3.forceLink(edges)
        .id((d: any) => d.id)
        .distance(150) // Larger distance to spread things out
        .strength(0.05) // Extremely weak to minimize movement
      )
      // Almost no charge force
      .force('charge', d3.forceManyBody().strength(-10))
      // Very weak center force
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.01))
      // Prevent overlap
      .force('collision', d3.forceCollide().radius(60))
      // Very quick decay to stop simulation almost immediately
      .alphaDecay(0.3)
      // Maximum damping for stability
      .velocityDecay(0.9)
      // Start with low alpha to minimize initial movement
      .alpha(0.1);

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
      } else if (d.type.toLowerCase() === 'person') {
        // Use silhouette.svg as fallback for person nodes without images
        nodeGroup.append('image')
          .attr('x', -20)
          .attr('y', -20)
          .attr('width', 40)
          .attr('height', 40)
          .attr('xlink:href', '/silhouette.svg')
          .attr('clip-path', 'circle(20px at center)')
          .on('click', (event) => {
            event.stopPropagation();
            onNodeClick(d);
          });
      } else {
        // For non-person nodes without images, use the first letter of the name
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
      
      // Add expand button for expandable nodes
      const isExpandable = expandableNodes.some(n => n.nodeId === d.id);
      const isExpanded = expandableNodes.some(n => n.nodeId === d.id && n.expanded);
      
      if (isExpandable && !isExpanded && onExpandNode) {
        // Add a circle background for the plus icon
        nodeGroup.append('circle')
          .attr('cx', 15)
          .attr('cy', -15)
          .attr('r', 8)
          .attr('fill', '#4f46e5') // Indigo color
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1.5)
          .attr('class', 'expand-button')
          .style('cursor', 'pointer')
          .on('click', (event) => {
            event.stopPropagation();
            onExpandNode(d.id);
          });
        
        // Add the plus symbol
        nodeGroup.append('text')
          .attr('x', 15)
          .attr('y', -15)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', '#ffffff')
          .attr('font-size', 12)
          .attr('font-weight', 'bold')
          .attr('class', 'expand-icon')
          .style('cursor', 'pointer')
          .text('+')
          .on('click', (event) => {
            event.stopPropagation();
            onExpandNode(d.id);
          });
      }
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

    // Improved drag behavior for smoother node movement
    function dragstarted(event: any, d: any) {
      // Immediately fix the node at its current position
      // This prevents any initial jump when starting to drag
      d.fx = d.x;
      d.fy = d.y;
      
      // Stop the simulation completely during drag
      simulation.alphaTarget(0);
      simulation.alpha(0);
      
      // Fix all other nodes in place during dragging to prevent unwanted movement
      simulation.nodes().forEach((node: any) => {
        if (node !== d) {
          node.fx = node.x;
          node.fy = node.y;
        }
      });
    }

    function dragged(event: any, d: any) {
      // Direct position setting for the dragged node
      // This gives the most precise control with no lag
      d.fx = event.x;
      d.fy = event.y;
      
      // Update the node's actual position to match the fixed position
      // This ensures consistency between fx/fy and x/y
      d.x = event.x;
      d.y = event.y;
    }

    function dragended(event: any, d: any) {
      // Keep the node fixed at its final position
      d.fx = d.x;
      d.fy = d.y;
      
      // Make sure simulation stays stopped
      simulation.alphaTarget(0);
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

      // Clean up simulation on unmount or when nodes/edges change
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [nodes, edges, hoveredNode]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (!isMounted.current) return;
      
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      if (svgRef.current) {
        d3.select(svgRef.current)
          .attr('viewBox', `0 0 ${width} ${height}`);
        
        // Update simulation center
        if (simulationRef.current) {
          simulationRef.current.force('center', d3.forceCenter(width / 2, height / 2));
          simulationRef.current.alpha(0.5).restart();
        }
      }
    };

    // Initial setup
    handleResize();
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Use a ref to track if we're mounted
  const isMounted = useRef(true);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="fixed top-0 left-0 w-screen h-screen"
      style={{ 
        margin: 0, 
        padding: 0, 
        overflow: 'hidden',
        backgroundColor: '#f9fafb' // Match the SVG background
      }}
    >
      <svg 
        ref={svgRef} 
        className="w-full h-full"
        style={{ 
          display: 'block',
          backgroundColor: '#f9fafb' // Match the container background
        }}
      />
    </div>
  );
};

export default D3NetworkGraph;
