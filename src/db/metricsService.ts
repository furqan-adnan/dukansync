import { db } from './db';

export type MetricType = 'sync_attempt' | 'sync_duration' | 'queue_size' | 'dlq_addition' | 'network_quality';

export interface SyncMetric {
  id?: number;
  metric_type: MetricType;
  value: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Records a metric to the syncMetrics table for operational visibility.
 */
export async function recordMetric(
  metricType: MetricType,
  value: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.syncMetrics.add({
    metric_type: metricType,
    value,
    timestamp: Date.now(),
    metadata,
  });
}

/**
 * Records a sync attempt metric (success or failure).
 */
export async function recordSyncAttempt(success: boolean, durationMs: number): Promise<void> {
  await Promise.all([
    recordMetric('sync_attempt', success ? 1 : 0, { success }),
    recordMetric('sync_duration', durationMs, { success }),
  ]);
}

/**
 * Records the current queue size as a metric.
 */
export async function recordQueueSize(size: number): Promise<void> {
  await recordMetric('queue_size', size);
}

/**
 * Records a DLQ addition event.
 */
export async function recordDLQAddition(entity: string, entityId: string): Promise<void> {
  await recordMetric('dlq_addition', 1, { entity, entity_id: entityId });
}

/**
 * Records network quality measurement.
 */
export async function recordNetworkQuality(quality: number, latencyMs: number): Promise<void> {
  await recordMetric('network_quality', quality, { latency_ms: latencyMs });
}

/**
 * Retrieves metrics within a time window.
 */
export async function getMetricsInTimeWindow(
  metricType: MetricType,
  startTime: number,
  endTime: number = Date.now()
): Promise<SyncMetric[]> {
  return await db.syncMetrics
    .where('metric_type')
    .equals(metricType)
    .and((metric) => metric.timestamp >= startTime && metric.timestamp <= endTime)
    .toArray();
}

/**
 * Calculates sync success rate over a time window.
 */
export async function getSyncSuccessRate(hours: number = 24): Promise<number> {
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const metrics = await getMetricsInTimeWindow('sync_attempt', startTime);

  if (metrics.length === 0) return 0; // No data = 0% to avoid confusion

  const successful = metrics.filter((m) => m.value === 1).length;
  return (successful / metrics.length) * 100;
}

/**
 * Calculates average sync duration over a time window.
 */
export async function getAverageSyncDuration(hours: number = 24): Promise<number> {
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const metrics = await getMetricsInTimeWindow('sync_duration', startTime);
  
  if (metrics.length === 0) return 0;
  
  const total = metrics.reduce((sum, m) => sum + m.value, 0);
  return total / metrics.length;
}

/**
 * Gets queue size history for charts.
 */
export async function getQueueSizeHistory(hours: number = 24): Promise<{ timestamp: number; size: number }[]> {
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const metrics = await getMetricsInTimeWindow('queue_size', startTime);
  
  return metrics.map((m) => ({
    timestamp: m.timestamp,
    size: m.value,
  }));
}

/**
 * Gets DLQ addition count over a time window.
 */
export async function getDLQAdditionCount(hours: number = 24): Promise<number> {
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const metrics = await getMetricsInTimeWindow('dlq_addition', startTime);
  
  return metrics.reduce((sum, m) => sum + m.value, 0);
}

/**
 * Gets current network quality (latest measurement).
 */
export async function getCurrentNetworkQuality(): Promise<number | null> {
  const metrics = await db.syncMetrics
    .where('metric_type')
    .equals('network_quality')
    .reverse()
    .limit(1)
    .toArray();
  
  return metrics.length > 0 ? metrics[0].value : null;
}

/**
 * Cleans up old metrics older than specified days.
 */
export async function cleanupOldMetrics(daysToKeep: number = 30): Promise<void> {
  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  
  await db.syncMetrics
    .where('timestamp')
    .below(cutoffTime)
    .delete();
}
