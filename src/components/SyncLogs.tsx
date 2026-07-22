import { useEffect, useState } from 'react';
import { db, type SyncLog } from '../db/db';

interface SyncLogsProps {
  className?: string;
}

export function SyncLogs({ className = '' }: SyncLogsProps) {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterOperation, setFilterOperation] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'timestamp' | 'duration'>('timestamp');

  useEffect(() => {
    const loadLogs = async () => {
      try {
        const allLogs = await db.syncLogs
          .orderBy('timestamp')
          .reverse()
          .limit(100)
          .toArray();
        
        setLogs(allLogs);
        setFilteredLogs(allLogs);
      } catch (error) {
        console.error('Failed to load sync logs:', error);
      } finally {
        setLoading(false);
      }
    };

    loadLogs();
  }, []);

  useEffect(() => {
    let filtered = [...logs];

    // Filter by status
    if (filterStatus !== 'all') {
      filtered = filtered.filter(log => log.status === filterStatus);
    }

    // Filter by operation
    if (filterOperation !== 'all') {
      filtered = filtered.filter(log => log.operation === filterOperation);
    }

    // Sort
    if (sortBy === 'timestamp') {
      filtered.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortBy === 'duration') {
      filtered.sort((a, b) => b.duration_ms - a.duration_ms);
    }

    setFilteredLogs(filtered);
  }, [logs, filterStatus, filterOperation, sortBy]);

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-50';
      case 'failure': return 'text-red-600 bg-red-50';
      case 'partial': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getOperationLabel = (operation: string) => {
    switch (operation) {
      case 'batch_sync': return 'Batch Sync';
      case 'sequential_sync': return 'Sequential Sync';
      case 'dlq_retry': return 'DLQ Retry';
      case 'integrity_check': return 'Integrity Check';
      default: return operation;
    }
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Operation', 'Status', 'Duration (ms)', 'Items Processed', 'Error'];
    const rows = filteredLogs.map(log => [
      formatTimestamp(log.timestamp),
      getOperationLabel(log.operation),
      log.status,
      log.duration_ms.toString(),
      log.items_processed.toString(),
      log.error_message || '',
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sync-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className={`p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-6 space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Sync Logs</h2>
        <button
          onClick={exportToCSV}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 p-4 bg-white rounded-lg shadow border border-gray-200">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="partial">Partial</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Operation</label>
          <select
            value={filterOperation}
            onChange={(e) => setFilterOperation(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">All</option>
            <option value="batch_sync">Batch Sync</option>
            <option value="sequential_sync">Sequential Sync</option>
            <option value="dlq_retry">DLQ Retry</option>
            <option value="integrity_check">Integrity Check</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'timestamp' | 'duration')}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="timestamp">Timestamp</option>
            <option value="duration">Duration</option>
          </select>
        </div>

        <div className="ml-auto text-sm text-gray-500">
          Showing {filteredLogs.length} of {logs.length} logs
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Operation
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Items
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Error
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    No logs found
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {getOperationLabel(log.operation)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDuration(log.duration_ms)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {log.items_processed}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                      {log.error_message || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
