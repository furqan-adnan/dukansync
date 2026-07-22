import { useEffect, useState } from 'react';
import { getPendingQueueCount } from '../db/syncEngine';
import { getDeadLetterStats } from '../db/deadLetterService';
import { getCurrentNetworkQualityMeasurement, getSignalStrengthBars, type NetworkQuality } from '../db/networkQualityService';

type SyncStatus = 'syncing' | 'synced' | 'offline' | 'error' | 'pending';

interface SyncStatusBadgeProps {
  className?: string;
  onClick?: () => void;
}

export function SyncStatusBadge({ className = '', onClick }: SyncStatusBadgeProps) {
  const [status, setStatus] = useState<SyncStatus>('synced');
  const [queueCount, setQueueCount] = useState(0);
  const [dlqCount, setDlqCount] = useState(0);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('good');
  const [signalBars, setSignalBars] = useState(3);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  useEffect(() => {
    const updateStatus = async () => {
      try {
        const [queue, dlqStats, network] = await Promise.all([
          getPendingQueueCount(),
          getDeadLetterStats(),
          getCurrentNetworkQualityMeasurement(),
        ]);

        setQueueCount(queue);
        setDlqCount(dlqStats.unresolved);
        
        if (network) {
          setNetworkQuality(network.quality);
          setSignalBars(getSignalStrengthBars(network.quality));
        }

        // Determine sync status
        if (!navigator.onLine) {
          setStatus('offline');
        } else if (queue > 0) {
          setStatus('pending');
        } else if (dlqStats.unresolved > 0) {
          setStatus('error');
        } else {
          setStatus('synced');
        }

        // Update last sync time (relative)
        setLastSyncTime('just now');
      } catch (error) {
        console.error('Failed to update sync status:', error);
        setStatus('error');
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = () => {
    switch (status) {
      case 'syncing': return '🔄';
      case 'synced': return '✅';
      case 'offline': return '📴';
      case 'error': return '❌';
      case 'pending': return '⏳';
      default: return '❓';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'syncing': return 'Syncing...';
      case 'synced': return 'Synced';
      case 'offline': return 'Offline';
      case 'error': return 'Sync Error';
      case 'pending': return 'Pending';
      default: return 'Unknown';
    }
  };

  const renderSignalBars = () => {
    const bars = [];
    for (let i = 1; i <= 4; i++) {
      const isActive = i <= signalBars;
      bars.push(
        <div
          key={i}
          className={`w-1 ${isActive ? 'bg-current' : 'bg-gray-300'} rounded-sm`}
          style={{ height: `${i * 3}px` }}
        />
      );
    }
    return <div className="flex items-end gap-0.5 h-4">{bars}</div>;
  };

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow ${className}`}
      title={`Status: ${getStatusText()} | Queue: ${queueCount} | DLQ: ${dlqCount} | Network: ${networkQuality}`}
    >
      <span className="text-lg">{getStatusIcon()}</span>
      <span className="text-gray-700">{getStatusText()}</span>
      
      {queueCount > 0 && (
        <span className="bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded-full">
          {queueCount}
        </span>
      )}
      
      {dlqCount > 0 && (
        <span className="bg-red-100 text-red-800 text-xs px-1.5 py-0.5 rounded-full">
          {dlqCount}
        </span>
      )}
      
      <div className="text-gray-500">
        {renderSignalBars()}
      </div>
      
      {lastSyncTime && (
        <span className="text-gray-400 text-xs">
          {lastSyncTime}
        </span>
      )}
    </button>
  );
}
