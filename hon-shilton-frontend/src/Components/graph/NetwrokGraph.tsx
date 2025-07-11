import React, { useState, useMemo, useRef, useEffect } from 'react';

// A helper function to manage transformations for zoom/pan
const getTransform = (transform) => `translate(${transform.x}, ${transform.y}) scale(${transform.k})`;

export default function NetworkGraph({ nodes, edges, onNodeClick, hoveredNode, setHoveredNode }) {
  const svgRef = useRef();
  const [localNodes, setLocalNodes] = useState([]);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggedNode, setDraggedNode] = useState(null); // Tracks the node being dragged

  useEffect(() => {
    // Initialize localNodes when the nodes prop changes
    setLocalNodes(nodes);
  }, [nodes]);

  // Memoize processed data to avoid re-computation on every render
  const { nodeMap, processedEdges } = useMemo(() => {
    const nodeMap = new Map(localNodes.map(node => [node.node_id, node]));
    const processedEdges = edges
      .map(edge => ({
        ...edge,
        source: nodeMap.get(edge.source_id),
        target: nodeMap.get(edge.target_id)
      }))
      .filter(edge => edge.source && edge.target); // Ensure edges are valid
    return { nodeMap, processedEdges };
  }, [localNodes, edges]);

  // Memoize connections for hovered node to optimize highlighting
  const { connectedNodes, connectedEdges } = useMemo(() => {
    if (!hoveredNode) {
      return { connectedNodes: new Set(localNodes.map(n => n.node_id)), connectedEdges: new Set(edges) };
    }
    const connectedNodeIds = new Set([hoveredNode]);
    const connectedEdgeObjects = new Set();
    edges.forEach(edge => {
      if (edge.source_id === hoveredNode || edge.target_id === hoveredNode) {
        connectedNodeIds.add(edge.source_id);
        connectedNodeIds.add(edge.target_id);
        connectedEdgeObjects.add(edge);
      }
    });
    return { connectedNodes: connectedNodeIds, connectedEdges: connectedEdgeObjects };
  }, [hoveredNode, localNodes, edges]);

  // Handle zooming
  const handleWheel = (e) => {
    if (!svgRef.current) return;
    e.preventDefault();
    const scaleFactor = 1.1;
    const { clientX, clientY, deltaY } = e;
    
    const svgPoint = svgRef.current.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    const pointInSVG = svgPoint.matrixTransform(svgRef.current.getScreenCTM().inverse());
    
    const newScale = deltaY < 0 ? transform.k * scaleFactor : transform.k / scaleFactor;
    const clampedScale = Math.max(0.5, Math.min(newScale, 3));
    
    const dx = pointInSVG.x * (1 - clampedScale / transform.k);
    const dy = pointInSVG.y * (1 - clampedScale / transform.k);
    
    setTransform(t => ({
      x: t.x + dx,
      y: t.y + dy,
      k: clampedScale
    }));
  };

  // Handle starting a pan or a drag
  const handleMouseDown = (e) => {
    // Check if we are clicking a node
    if (e.target.closest('.node-element')) {
      const nodeId = e.target.closest('.node-element').dataset.id;
      const node = localNodes.find(n => n.node_id === nodeId);
      if (node) {
        e.stopPropagation();
        const pointInSVG = getPointInSVG(e.clientX, e.clientY);
        setDraggedNode({
          id: nodeId,
          offsetX: node.position_x - pointInSVG.x,
          offsetY: node.position_y - pointInSVG.y
        });
      }
    } else { // Start panning the canvas
      e.preventDefault();
      setIsPanning(true);
      const pointInSVG = getPointInSVG(e.clientX, e.clientY);
      setPanStart({ x: pointInSVG.x, y: pointInSVG.y });
    }
  };
  
  const handleMouseMove = (e) => {
    if (draggedNode) { // Drag a node
      e.preventDefault();
      const { x, y } = getPointInSVG(e.clientX, e.clientY);
      setLocalNodes(currentNodes => currentNodes.map(n => {
        if (n.node_id === draggedNode.id) {
          return { ...n, position_x: x + draggedNode.offsetX, position_y: y + draggedNode.offsetY };
        }
        return n;
      }));
    } else if (isPanning) { // Pan the canvas
      e.preventDefault();
      const { x, y } = getPointInSVG(e.clientX, e.clientY);
      setTransform(t => ({
        ...t,
        x: t.x + (x - panStart.x) * t.k,
        y: t.y + (y - panStart.y) * t.k
      }));
    }
  };
  
  const handleMouseUp = (e) => {
    e.preventDefault();
    setIsPanning(false);
    setDraggedNode(null);
  };

  const getPointInSVG = (clientX, clientY) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svgPoint = svgRef.current.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    return svgPoint.matrixTransform(svgRef.current.getScreenCTM().inverse());
  };
  
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    
    if (nodes.length > 0) {
      // Fit graph logic... (remains same)
      const xCoords = nodes.map(n => n.position_x).filter(x => x !== null);
      const yCoords = nodes.map(n => n.position_y).filter(y => y !== null);
      if (xCoords.length === 0 || yCoords.length === 0) return;
      
      const minX = Math.min(...xCoords);
      const maxX = Math.max(...xCoords);
      const minY = Math.min(...yCoords);
      const maxY = Math.max(...yCoords);

      const graphWidth = maxX - minX;
      const graphHeight = maxY - minY;
      
      const { width, height } = svgEl.getBoundingClientRect();
      
      if (graphWidth > 0 && graphHeight > 0 && width > 0 && height > 0) {
        const scaleX = width / (graphWidth + 100);
        const scaleY = height / (graphHeight + 100);
        const newScale = Math.min(scaleX, scaleY, 1);
        
        const newX = (width - graphWidth * newScale) / 2 - minX * newScale;
        const newY = (height - graphHeight * newScale) / 2 - minY * newScale;
        
        setTransform({ x: newX, y: newY, k: newScale });
      }
    }

    svgEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', handleWheel);
  }, [nodes]);

  const getCursor = () => {
    if (draggedNode) return 'grabbing';
    if (isPanning) return 'grabbing';
    return 'grab';
  }

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: getCursor() }}
    >
      <g transform={getTransform(transform)}>
        {/* Edges */}
        <g>
          {processedEdges.map((edge) => (
            <g key={`${edge.source_id}-${edge.target_id}`}>
              <line
                x1={edge.source.position_x}
                y1={edge.source.position_y}
                x2={edge.target.position_x}
                y2={edge.target.position_y}
                stroke="#cbd5e1"
                strokeWidth={2}
                style={{
                  opacity: connectedEdges.has(edge) ? 0.9 : 0.2,
                  transition: 'opacity 0.3s'
                }}
              />
              <text
                x={(edge.source.position_x + edge.target.position_x) / 2}
                y={(edge.source.position_y + edge.target.position_y) / 2}
                dy={-5}
                textAnchor="middle"
                fontSize="12px"
                fontWeight="500"
                fill="#64748b"
                 style={{
                  opacity: connectedEdges.has(edge) ? 1 : 0.2,
                  transition: 'opacity 0.3s'
                }}
              >
                {edge.relationship}
              </text>
            </g>
          ))}
        </g>
        {/* Nodes */}
        <g>
          {localNodes.map((node) => (
            <g
              key={node.node_id}
              className="node-element"
              data-id={node.node_id}
              transform={`translate(${node.position_x}, ${node.position_y})`}
              style={{
                opacity: connectedNodes.has(node.node_id) ? 1 : 0.3,
                transition: 'opacity 0.3s',
                cursor: draggedNode?.id === node.node_id ? 'grabbing' : 'pointer'
              }}
              onMouseEnter={() => !draggedNode && setHoveredNode(node.node_id)}
              onMouseLeave={() => !draggedNode && setHoveredNode(null)}
              onClick={() => onNodeClick(node)}
              onMouseDown={(e) => e.stopPropagation()} // Prevent canvas pan when clicking node
            >
              <circle
                r={node.type === 'person' ? 30 : 20}
                fill={node.type === 'person' ? '#3b82f6' : '#ef4444'}
                stroke="#ffffff"
                strokeWidth={3}
                style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))' }}
              />
              {node.type === 'person' && node.image_url && (
                <image
                  href={node.image_url}
                  x={-25}
                  y={-25}
                  height={50}
                  width={50}
                  clipPath="circle(25px at 25px 25px)"
                />
              )}
              {node.type === 'connector' && (
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize="16px"
                  fontWeight="bold"
                  fill="#ffffff"
                  style={{ pointerEvents: 'none' }}
                >
                  +
                </text>
              )}
              <text
                textAnchor="middle"
                y={node.type === 'person' ? 45 : 35}
                fontSize="14px"
                fontWeight="600"
                fill="#1e293b"
                style={{ pointerEvents: 'none' }}
              >
                {node.name}
              </text>
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}