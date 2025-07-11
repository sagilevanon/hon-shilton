import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, User, Link as LinkIcon } from 'lucide-react';

export default function NodeDetailsPanel({ node, onClose }) {
  if (!node) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-50"
    >
      <Card className="h-full rounded-none border-l border-gray-200">
        <CardHeader className="border-b border-gray-100 pb-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold text-gray-900">
              {node.type === 'person' ? 'Person Details' : 'Connector Details'}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="p-6 space-y-6">
          <div className="text-center">
            {node.type === 'person' && node.image_url ? (
              <img
                src={node.image_url}
                alt={node.name}
                className="w-24 h-24 rounded-full mx-auto mb-4 object-cover ring-4 ring-blue-100"
              />
            ) : (
              <div className={`w-24 h-24 rounded-full mx-auto mb-4 flex items-center justify-center ${
                node.type === 'person' ? 'bg-blue-500' : 'bg-red-500'
              }`}>
                {node.type === 'person' ? (
                  <User className="w-12 h-12 text-white" />
                ) : (
                  <LinkIcon className="w-12 h-12 text-white" />
                )}
              </div>
            )}
            
            <h3 className="text-2xl font-bold text-gray-900 mb-2">{node.name}</h3>
            <Badge 
              variant="secondary" 
              className={`${
                node.type === 'person' 
                  ? 'bg-blue-100 text-blue-800' 
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {node.type === 'person' ? 'Person' : 'Connector'}
            </Badge>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-700 mb-2">Description</h4>
              <p className="text-gray-600 leading-relaxed">
                {node.description || 'No description available.'}
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-gray-700 mb-2">Node ID</h4>
              <code className="bg-gray-100 px-2 py-1 rounded text-sm text-gray-800">
                {node.node_id}
              </code>
            </div>

            {node.type === 'person' && (
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Type</h4>
                <p className="text-gray-600">Individual Person</p>
              </div>
            )}

            {node.type === 'connector' && (
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Function</h4>
                <p className="text-gray-600">Connection Hub - Links multiple people together</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}