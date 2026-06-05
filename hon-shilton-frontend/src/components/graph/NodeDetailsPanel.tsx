import React from 'react';
import { Node } from '@/types';
import { X, User, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NodeDetailsPanelProps {
  node: Node | null;
  onClose: () => void;
}

export default function NodeDetailsPanel({ node, onClose }: NodeDetailsPanelProps) {
  if (!node) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-lg z-50 overflow-y-auto">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            {node.type === 'person' ? 'Person Details' : 'Connector Details'}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="text-center">
          {node.type === 'person' && node.image ? (
            <img
              src={node.image}
              alt={node.name}
              className="w-24 h-24 rounded-full mx-auto mb-4 object-cover ring-4 ring-blue-100"
            />
          ) : (
            <div
              className={`w-24 h-24 rounded-full mx-auto mb-4 flex items-center justify-center ${
                node.type === 'person' ? 'bg-blue-500' : 'bg-red-500'
              }`}
            >
              {node.type === 'person' ? (
                <User className="w-12 h-12 text-white" />
              ) : (
                <LinkIcon className="w-12 h-12 text-white" />
              )}
            </div>
          )}
          <h3 className="text-lg font-semibold text-gray-900">{node.name}</h3>
          {node.type === 'person' && (
            <p className="text-sm text-gray-500">{node.description || 'No description available'}</p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-gray-500">Node ID</h4>
            <p className="mt-1 text-sm text-gray-900">{node.id}</p>
          </div>

          {node.type === 'linkingEntity' && node.description && (
            <div>
              <h4 className="text-sm font-medium text-gray-500">Description</h4>
              <p className="mt-1 text-sm text-gray-900">{node.description}</p>
            </div>
          )}

          <div>
            <h4 className="text-sm font-medium text-gray-500">Type</h4>
            <div className="mt-1">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  node.type === 'person'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {node.type.charAt(0).toUpperCase() + node.type.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
