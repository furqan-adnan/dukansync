import React, { useState, useEffect } from 'react';
import { getDeadLetterItems, retryDeadLetterItem, discardDeadLetterItem, getDeadLetterStats } from '../db/deadLetterService';
import type { DeadLetterQueueItem } from '../db/db';

export function DeadLetterPanel() {
  const [items, setItems] = useState<DeadLetterQueueItem[]>([]);
  const [stats, setStats] = useState({ total: 0, unresolved: 0, resolved: 0 });

  useEffect(() => {
    loadItems();
    loadStats();
  }, []);

  const loadItems = async () => {
    setItems(await getDeadLetterItems());
  };

  const loadStats = async () => {
    setStats(await getDeadLetterStats());
  };

  const handleRetry = async (id: number) => {
    await retryDeadLetterItem(id);
    await loadItems();
    await loadStats();
  };

  const handleDiscard = async (id: number) => {
    const notes = prompt('Enter reason for discarding:');
    if (notes) {
      await discardDeadLetterItem(id, notes);
      await loadItems();
      await loadStats();
    }
  };

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <h2 className="text-xl font-bold text-red-800 mb-4">
        Dead Letter Queue
      </h2>
      
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-white p-3 rounded">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-sm text-gray-600">Total</div>
        </div>
        <div className="bg-white p-3 rounded">
          <div className="text-2xl font-bold text-red-600">{stats.unresolved}</div>
          <div className="text-sm text-gray-600">Unresolved</div>
        </div>
        <div className="bg-white p-3 rounded">
          <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
          <div className="text-sm text-gray-600">Resolved</div>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-gray-600">No unresolved items in Dead Letter Queue</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="bg-white p-3 rounded border border-red-200">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold text-gray-900">
                    {item.original_queue_item.entity.toUpperCase()} - {item.original_queue_item.operation}
                  </div>
                  <div className="text-sm text-gray-600">
                    Entity ID: {item.original_queue_item.entity_id}
                  </div>
                  <div className="text-sm text-red-600 mt-1">
                    Failed: {item.failure_reason}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Failed at: {new Date(item.failed_at).toLocaleString()}
                  </div>
                </div>
                <div className="space-x-2 flex">
                  <button
                    onClick={() => handleRetry(item.id as number)}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => handleDiscard(item.id as number)}
                    className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors shadow-sm"
                  >
                    Discard
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
