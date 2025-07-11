import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NodeAPI, EdgeAPI } from '@/services/api';
import { Node, Edge } from '@/types';
import D3NetworkGraph from '../components/graph/D3NetworkGraph';
import NodeDetailsPanel from '../components/graph/NodeDetailsPanel';
import { Button } from "@/components/ui/button";
import { RefreshCw, Users, Link as LinkIcon } from 'lucide-react';

interface GraphStats {
  persons: number;
  linkingEntitys: number;
  connections: number;
}

export default function NetworkGraphPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<GraphStats>({ persons: 0, linkingEntitys: 0, connections: 0 });

  useEffect(() => {
    console.log('in useEffect')
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      console.log('Fetching nodes and edges...');
      const [nodesData, edgesData] = await Promise.all([
        NodeAPI.list(),
        EdgeAPI.list()
      ]);
      
      console.log('Nodes data:', nodesData);
      console.log('Edges data:', edgesData);
      
      // Ensure nodes have required properties
      const processedNodes = nodesData.map(node => ({
        ...node,
        name: node.name || `Node ${node.id}`,
        group: node.group || 1,
        type: node.type || 'unknown'
      }));
      
      setNodes(processedNodes);
      setEdges(edgesData);
      
      const persons = processedNodes.filter(n => n.type === 'person').length;
      const linkingEntitys = processedNodes.length - persons;
      setStats({ 
        persons, 
        linkingEntitys, 
        connections: edgesData.length 
      });
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNodeClick = (node: Node) => {
    console.log('Node clicked:', node);
    setSelectedNode(node);
  };

  const closeDetailsPanel = () => {
    setSelectedNode(null);
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading network...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-blue-50 relative overflow-hidden">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Network Graph</h1>
              <p className="text-gray-600 mt-1">Explore connections between people and entities</p>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span className="font-medium">{stats.persons} People</span>
                </div>
                <div className="flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-red-500" />
                  <span className="font-medium">{stats.linkingEntitys} Connectors</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 flex items-center justify-center">
                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  </span>
                  <span className="font-medium">{stats.connections} Connections</span>
                </div>
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                disabled={isLoading}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Graph Container */}
      <div className="absolute inset-0 pt-20">
        <div className="w-full h-full">
          <D3NetworkGraph
            nodes={nodes}
            edges={edges}
            onNodeClick={handleNodeClick}
            hoveredNode={hoveredNode}
            setHoveredNode={setHoveredNode}
          />
        </div>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-6 left-6 bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-lg max-w-sm">
        <h3 className="font-semibold text-gray-900 mb-2">How to Use</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• <strong>Hover</strong> over nodes to highlight connections</li>
          <li>• <strong>Click</strong> on nodes to view details</li>
          <li>• <strong>Drag</strong> to pan around the graph</li>
          <li>• <strong>Scroll</strong> to zoom in and out</li>
        </ul>
      </div>

      {/* Node Details Panel */}
      <AnimatePresence>
        {selectedNode && (
          <NodeDetailsPanel
            node={selectedNode}
            onClose={closeDetailsPanel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}