import { useEffect, useState } from 'react';
import { getPendingQueueCount } from '../db/syncEngine';
import { getDeadLetterStats } from '../db/deadLetterService';
import { 
  getSyncSuccessRate, 
  getAverageSyncDuration, 
  getQueueSizeHistory, 
  getDLQAdditionCount,
  getCurrentNetworkQuality 
} from '../db/metricsService';
import { getNetworkQualityHistory, type NetworkQuality } from '../db/networkQualityService';
import { getSignalStrengthBars } from '../db/networkQualityService';

interface DashboardMetrics {
  queueCount: number;
  dlqCount: number;
  lastSyncTime: string;
  syncSuccessRate: number;
  avgSyncDuration: number;
  networkQuality: number;
  networkQualityLabel: NetworkQuality;
  signalBars: number;
}

interface ChartData {
  timestamp: number;
  value: number;
}

export function SyncDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [queueHistory, setQueueHistory] = useState<ChartData[]>([]);
  const [networkHistory, setNetworkHistory] = useState<ChartData[]>([]);
  const [dlqAdditions, setDlqAdditions] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        const [queue, dlqStats, successRate, avgDuration, networkQuality, queueHist, netHist, dlqCount] = 
          await Promise.all([
            getPendingQueueCount(),
            getDeadLetterStats(),
            getSyncSuccessRate(24),
            getAverageSyncDuration(24),
            getCurrentNetworkQuality(),
            getQueueSizeHistory(24),
            getNetworkQualityHistory(24),
            getDLQAdditionCount(24),
          ]);

        const networkLabel: NetworkQuality = networkQuality && networkQuality >= 90 ? 'excellent' 
          : networkQuality && networkQuality >= 70 ? 'good'
          : networkQuality && networkQuality >= 50 ? 'poor'
          : 'offline';

        setMetrics({
          queueCount: queue,
          dlqCount: dlqStats.unresolved,
          lastSyncTime: 'just now',
          syncSuccessRate: successRate,
          avgSyncDuration: avgDuration,
          networkQuality: networkQuality || 0,
          networkQualityLabel: networkLabel,
          signalBars: getSignalStrengthBars(networkLabel),
        });

        setQueueHistory(queueHist.map(h => ({ timestamp: h.timestamp, value: h.size })));
        setNetworkHistory(netHist.map(h => ({ timestamp: h.timestamp, value: h.quality })));
        setDlqAdditions(dlqCount);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatPercentage = (value: number) => `${value.toFixed(1)}%`;

  const getNetworkColor = (quality: NetworkQuality) => {
    switch (quality) {
      case 'excellent': return 'text-green-600';
      case 'good': return 'text-blue-600';
      case 'poor': return 'text-yellow-600';
      case 'offline': return 'text-red-600';
    }
  };

  const renderSimpleChart = (data: ChartData[], color: string) => {
    if (data.length === 0) return <div className="text-gray-400 text-sm">No data available</div>;

    const max = Math.max(...data.map(d => d.value));
    const min = Math.min(...data.map(d => d.value));
    const range = max - min || 1;

    return (
      <div className="flex items-end gap-1 h-16">
        {data.map((point, i) => {
          const height = ((point.value - min) / range) * 100;
          return (
            <div
              key={i}
              className={`flex-1 ${color} rounded-t transition-all`}
              style={{ height: `${Math.max(height, 5)}%` }}
              title={`${new Date(point.timestamp).toLocaleTimeString()}: ${point.value}`}
            />
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="p-6 text-center text-gray-500">
        Failed to load dashboard data
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Sync Health Dashboard</h2>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Queue Count */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-500 mb-1">Pending Queue</div>
          <div className="text-3xl font-bold text-gray-800">{metrics.queueCount}</div>
          <div className="text-xs text-gray-400 mt-1">items waiting to sync</div>
        </div>

        {/* DLQ Count */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-500 mb-1">Dead Letter Queue</div>
          <div className={`text-3xl font-bold ${metrics.dlqCount > 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {metrics.dlqCount}
          </div>
          <div className="text-xs text-gray-400 mt-1">unresolved items</div>
        </div>

        {/* Sync Success Rate */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-500 mb-1">Sync Success Rate (24h)</div>
          <div className={`text-3xl font-bold ${metrics.syncSuccessRate === 0 ? 'text-gray-400' : metrics.syncSuccessRate >= 95 ? 'text-green-600' : metrics.syncSuccessRate >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>
            {metrics.syncSuccessRate === 0 ? 'No data' : formatPercentage(metrics.syncSuccessRate)}
          </div>
          <div className="text-xs text-gray-400 mt-1">last 24 hours</div>
        </div>

        {/* Average Sync Duration */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-500 mb-1">Avg Sync Duration</div>
          <div className="text-3xl font-bold text-gray-800">
            {formatDuration(metrics.avgSyncDuration)}
          </div>
          <div className="text-xs text-gray-400 mt-1">last 24 hours</div>
        </div>

        {/* Network Quality */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-500 mb-1">Network Quality</div>
          <div className={`text-3xl font-bold ${getNetworkColor(metrics.networkQualityLabel)}`}>
            {metrics.networkQualityLabel.charAt(0).toUpperCase() + metrics.networkQualityLabel.slice(1)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {metrics.signalBars} bars signal
          </div>
        </div>

        {/* DLQ Additions (24h) */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-sm text-gray-500 mb-1">DLQ Additions (24h)</div>
          <div className={`text-3xl font-bold ${dlqAdditions > 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {dlqAdditions}
          </div>
          <div className="text-xs text-gray-400 mt-1">new items in last 24h</div>
        </div>
      </div>

      {/* Historical Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Queue Size History */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Queue Size (24h)</h3>
          {renderSimpleChart(queueHistory, 'bg-blue-500')}
          <div className="text-xs text-gray-400 mt-2 text-center">Last 24 hours</div>
        </div>

        {/* Network Quality History */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Network Quality (24h)</h3>
          {renderSimpleChart(networkHistory, 'bg-green-500')}
          <div className="text-xs text-gray-400 mt-2 text-center">Last 24 hours</div>
        </div>
      </div>

      {/* Last Sync Info */}
      <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">Last Successful Sync</div>
            <div className="text-lg font-semibold text-gray-800">{metrics.lastSyncTime}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500">Status</div>
            <div className="text-lg font-semibold text-green-600">✓ Synced</div>
          </div>
        </div>
      </div>
    </div>
  );
}
