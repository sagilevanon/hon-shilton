import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Node, Edge } from '@/types';

interface NetworkGraphProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (node: Node) => void;
  hoveredNode: string | null;
  setHoveredNode: (nodeId: string | null) => void;
}

export default function NetworkGraph({
  nodes,
  edges,
  onNodeClick,
  hoveredNode,
  setHoveredNode,
}: NetworkGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Handle window resize
  useEffect(() => {
    const updateDimensions = () => {
      if (svgRef.current && svgRef.current.parentElement) {
        const { width, height } = svgRef.current.parentElement.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Calculate node positions using D3 force layout
  const [nodePositions, setNodePositions] = useState<Record<number, {x: number, y: number}>>({});
  
  useEffect(() => {
    if (nodes.length === 0) return;
    
    // Simple force-directed layout simulation
    const width = dimensions.width;
    const height = dimensions.height;
    
    // Initialize positions randomly
    const positions: Record<number, {x: number, y: number}> = {};
    nodes.forEach(node => {
      positions[node.id] = {
        x: Math.random() * width * 0.8 + width * 0.1,
        y: Math.random() * height * 0.8 + height * 0.1
      };
    });
    
    // Simple force simulation (repulsion only)
    const repulsion = 150;
    
    // Run a few iterations to spread nodes
    for (let i = 0; i < 100; i++) {
      nodes.forEach((node1, i) => {
        let fx = 0;
        let fy = 0;
        
        // Repulsion between all nodes
        nodes.forEach((node2, j) => {
          if (i === j) return;
          
          const dx = positions[node1.id].x - positions[node2.id].x;
          const dy = positions[node1.id].y - positions[node2.id].y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = repulsion / (d * d);
          
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        });
        
        // Apply forces with some damping
        positions[node1.id].x = Math.max(0, Math.min(width, positions[node1.id].x + fx * 0.1));
        positions[node1.id].y = Math.max(0, Math.min(height, positions[node1.id].y + fy * 0.1));
      });
    }
    
    setNodePositions(positions);
  }, [nodes, dimensions]);

  return (
    <div className="w-full h-full">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="bg-gray-50"
      >
        {/* Edges */}
        {edges.map((edge, index) => {
          const sourcePos = nodePositions[edge.source];
          const targetPos = nodePositions[edge.target];
          
          if (!sourcePos || !targetPos) return null;
          
          return (
            <line
              key={`edge-${index}`}
              x1={sourcePos.x}
              y1={sourcePos.y}
              x2={targetPos.x}
              y2={targetPos.y}
              stroke="#94a3b8"
              strokeWidth="2"
              className={`transition-opacity ${hoveredNode && hoveredNode !== edge.source.toString() && hoveredNode !== edge.target.toString() ? 'opacity-30' : 'opacity-70'}`}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = nodePositions[node.id];
          if (!pos) return null;
          
          return (
            <g
              key={node.id}
              onClick={() => onNodeClick(node)}
              onMouseEnter={() => setHoveredNode(node.id.toString())}
              onMouseLeave={() => setHoveredNode(null)}
              className={`cursor-pointer transition-transform ${hoveredNode === node.id.toString() ? 'scale-110' : ''}`}
              transform={`translate(${pos.x}, ${pos.y})`}
            >
              <circle
                r={20}
                fill={node.group === 4 ? '#3b82f6' : '#ef4444'}
                className="shadow-md"
              />
              {node.image ? (
                <image
                  href={node.image}
                  x={-20}
                  y={-20}
                  width={40}
                  height={40}
                  className="rounded-full"
                  clipPath="circle(20px at center)"
                />
              ) : (
                <text
                  x={0}
                  y={5}
                  textAnchor="middle"
                  className="text-xs font-medium fill-white"
                >
                  {node.name.charAt(0).toUpperCase()}
                </text>
              )}
              <text
                x={0}
                y={30}
                textAnchor="middle"
                className="text-xs font-medium fill-gray-700"
              >
                {node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
