import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../db';
import {
  recordMetric,
  recordSyncAttempt,
  recordQueueSize,
  recordDLQAddition,
  recordNetworkQuality,
  getMetricsInTimeWindow,
  getSyncSuccessRate,
  getAverageSyncDuration,
  getQueueSizeHistory,
  getDLQAdditionCount,
  getCurrentNetworkQuality,
  cleanupOldMetrics,
} from '../metricsService';

vi.mock('../supabaseClient', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
      delete: vi.fn(() => Promise.resolve({ error: null })),
    })),
    rpc: vi.fn(),
  },
}));

describe('Metrics Service', () => {
  beforeEach(async () => {
    await db.syncMetrics.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a metric to the database', async () => {
    await recordMetric('queue_size', 42);

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(1);
    expect(metrics[0].metric_type).toBe('queue_size');
    expect(metrics[0].value).toBe(42);
    expect(metrics[0].timestamp).toBeGreaterThan(0);
  });

  it('records a metric with metadata', async () => {
    await recordMetric('sync_attempt', 1, { success: true });

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(1);
    expect(metrics[0].metadata).toEqual({ success: true });
  });

  it('records sync attempt metrics', async () => {
    await recordSyncAttempt(true, 1500);

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(2);
    expect(metrics[0].metric_type).toBe('sync_attempt');
    expect(metrics[0].value).toBe(1);
    expect(metrics[1].metric_type).toBe('sync_duration');
    expect(metrics[1].value).toBe(1500);
  });

  it('records queue size metric', async () => {
    await recordQueueSize(25);

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(1);
    expect(metrics[0].metric_type).toBe('queue_size');
    expect(metrics[0].value).toBe(25);
  });

  it('records DLQ addition metric', async () => {
    await recordDLQAddition('products', 'prod-123');

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(1);
    expect(metrics[0].metric_type).toBe('dlq_addition');
    expect(metrics[0].metadata).toEqual({ entity: 'products', entity_id: 'prod-123' });
  });

  it('records network quality metric', async () => {
    await recordNetworkQuality(75, 200);

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(1);
    expect(metrics[0].metric_type).toBe('network_quality');
    expect(metrics[0].value).toBe(75);
    expect(metrics[0].metadata).toEqual({ latency_ms: 200 });
  });

  it('retrieves metrics within a time window', async () => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    await recordMetric('queue_size', 10);
    await new Promise(resolve => setTimeout(resolve, 10));
    await recordMetric('queue_size', 20);

    const metrics = await getMetricsInTimeWindow('queue_size', oneHourAgo, now + 1000);
    expect(metrics.length).toBe(2);
  });

  it('calculates sync success rate', async () => {
    // Record 5 successful syncs and 2 failures
    for (let i = 0; i < 5; i++) {
      await recordMetric('sync_attempt', 1);
    }
    for (let i = 0; i < 2; i++) {
      await recordMetric('sync_attempt', 0);
    }

    const successRate = await getSyncSuccessRate(24);
    expect(successRate).toBeCloseTo(71.43, 1); // 5/7 ≈ 71.43%
  });

  it('returns 0% success rate when no metrics exist', async () => {
    const successRate = await getSyncSuccessRate(24);
    expect(successRate).toBe(0);
  });

  it('calculates average sync duration', async () => {
    await recordMetric('sync_duration', 1000);
    await recordMetric('sync_duration', 2000);
    await recordMetric('sync_duration', 3000);

    const avgDuration = await getAverageSyncDuration(24);
    expect(avgDuration).toBe(2000);
  });

  it('returns 0 average duration when no metrics exist', async () => {
    const avgDuration = await getAverageSyncDuration(24);
    expect(avgDuration).toBe(0);
  });

  it('gets queue size history', async () => {
    await recordMetric('queue_size', 10);
    await new Promise(resolve => setTimeout(resolve, 10));
    await recordMetric('queue_size', 15);
    await new Promise(resolve => setTimeout(resolve, 10));
    await recordMetric('queue_size', 20);

    const history = await getQueueSizeHistory(24);
    expect(history.length).toBe(3);
    expect(history[0].size).toBe(10);
    expect(history[1].size).toBe(15);
    expect(history[2].size).toBe(20);
  });

  it('gets DLQ addition count', async () => {
    await recordMetric('dlq_addition', 1);
    await recordMetric('dlq_addition', 1);
    await recordMetric('dlq_addition', 1);

    const count = await getDLQAdditionCount(24);
    expect(count).toBe(3);
  });

  it('gets current network quality', async () => {
    await recordMetric('network_quality', 85);

    const quality = await getCurrentNetworkQuality();
    expect(quality).toBe(85);
  });

  it('returns null when no network quality metrics exist', async () => {
    const quality = await getCurrentNetworkQuality();
    expect(quality).toBeNull();
  });

  it('cleans up old metrics', async () => {
    const now = Date.now();
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

    // Add old metric
    await db.syncMetrics.add({
      metric_type: 'queue_size',
      value: 10,
      timestamp: thirtyOneDaysAgo,
    });

    // Add recent metric
    await db.syncMetrics.add({
      metric_type: 'queue_size',
      value: 20,
      timestamp: now,
    });

    await cleanupOldMetrics(30);

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(1);
    expect(metrics[0].value).toBe(20);

    await db.syncMetrics.clear();
  });
});
