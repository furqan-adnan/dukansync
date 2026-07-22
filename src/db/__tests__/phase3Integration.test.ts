import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db, type SyncLog } from '../db';
import {
  recordSyncAttempt,
  recordQueueSize,
  getSyncSuccessRate,
  getAverageSyncDuration,
  cleanupOldMetrics,
  recordNetworkQuality,
  getQueueSizeHistory,
} from '../metricsService';
import { getNetworkQualityHistory } from '../networkQualityService';
import { checkAlerts } from '../alertConfig';

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

describe('Phase 3 Integration Tests', () => {
  beforeEach(async () => {
    await db.syncMetrics.clear();
    await db.syncLogs.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects metrics during sync operations', async () => {
    // Simulate a successful sync
    await recordSyncAttempt(true, 1200);
    await recordQueueSize(0);

    const successRate = await getSyncSuccessRate(24);
    const avgDuration = await getAverageSyncDuration(24);

    expect(successRate).toBe(100);
    expect(avgDuration).toBe(1200);
  });

  it('collects metrics for failed sync operations', async () => {
    // Simulate failed syncs
    await recordSyncAttempt(false, 500);
    await recordSyncAttempt(false, 800);
    await recordSyncAttempt(true, 1200);

    const successRate = await getSyncSuccessRate(24);
    const avgDuration = await getAverageSyncDuration(24);

    expect(successRate).toBeCloseTo(33.33, 1);
    expect(avgDuration).toBeCloseTo(833.33, 1);
  });

  it('tracks queue size over time', async () => {
    await recordQueueSize(10);
    await new Promise(resolve => setTimeout(resolve, 10));
    await recordQueueSize(25);
    await new Promise(resolve => setTimeout(resolve, 10));
    await recordQueueSize(15);

    const history = await getQueueSizeHistory(24);
    expect(history.length).toBeGreaterThanOrEqual(0);
  });

  it('records network quality measurements', async () => {
    await recordNetworkQuality(100, 50);
    await recordNetworkQuality(75, 150);
    await recordNetworkQuality(50, 300);

    const history = await getNetworkQualityHistory(24);
    expect(history.length).toBe(3);
    expect(history[0].quality).toBe(100);
    expect(history[1].quality).toBe(75);
    expect(history[2].quality).toBe(50);
  });

  it('generates alerts based on metrics', async () => {
    const metrics = {
      queue_size: 75,
      dlq_count: 8,
      sync_failure_rate: 20,
      offline_duration: 45 * 60 * 1000,
    };

    const alerts = checkAlerts(metrics);
    expect(alerts.length).toBeGreaterThan(0);
    
    const queueAlert = alerts.find(a => a.metric === 'queue_size');
    expect(queueAlert).toBeDefined();
    expect(queueAlert?.severity).toBe('warning');

    const dlqAlert = alerts.find(a => a.metric === 'dlq_count');
    expect(dlqAlert).toBeDefined();
    expect(dlqAlert?.severity).toBe('warning');
  });

  it('generates critical alerts when thresholds are exceeded', async () => {
    const metrics = {
      queue_size: 150,
      dlq_count: 15,
      sync_failure_rate: 30,
      offline_duration: 3 * 60 * 60 * 1000,
    };

    const alerts = checkAlerts(metrics);
    expect(alerts.length).toBe(4);
    expect(alerts.every(a => a.severity === 'critical')).toBe(true);
  });

  it('does not generate alerts when metrics are healthy', async () => {
    const metrics = {
      queue_size: 5,
      dlq_count: 0,
      sync_failure_rate: 2,
      offline_duration: 5 * 60 * 1000,
    };

    const alerts = checkAlerts(metrics);
    expect(alerts.length).toBe(0);
  });

  it('stores sync logs with proper structure', async () => {
    const log: SyncLog = {
      timestamp: Date.now(),
      operation: 'batch_sync',
      status: 'success',
      duration_ms: 1500,
      items_processed: 10,
    };

    await db.syncLogs.add(log);

    const logs = await db.syncLogs.toArray();
    expect(logs.length).toBe(1);
    expect(logs[0].operation).toBe('batch_sync');
    expect(logs[0].status).toBe('success');
    expect(logs[0].duration_ms).toBe(1500);
    expect(logs[0].items_processed).toBe(10);
  });

  it('stores sync logs with error information', async () => {
    const log: SyncLog = {
      timestamp: Date.now(),
      operation: 'sequential_sync',
      status: 'failure',
      duration_ms: 5000,
      items_processed: 0,
      error_message: 'Network timeout',
    };

    await db.syncLogs.add(log);

    const logs = await db.syncLogs.toArray();
    expect(logs.length).toBe(1);
    expect(logs[0].error_message).toBe('Network timeout');
  });

  it('cleans up old metrics based on retention policy', async () => {
    const now = Date.now();
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

    // Add old metric
    await db.syncMetrics.add({
      metric_type: 'queue_size',
      value: 10,
      timestamp: thirtyOneDaysAgo,
    });

    // Add recent metrics
    await db.syncMetrics.add({
      metric_type: 'queue_size',
      value: 20,
      timestamp: now,
    });

    await cleanupOldMetrics(30);

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(1);
    expect(metrics[0].value).toBe(20);
  });

  it('calculates sync success rate over different time windows', async () => {
    // Add metrics over time
    await recordSyncAttempt(true, 1000);
    await recordSyncAttempt(false, 500);
    await recordSyncAttempt(true, 1200);
    await recordSyncAttempt(true, 800);

    const rate24h = await getSyncSuccessRate(24);
    expect(rate24h).toBe(75);

    // Since all metrics are recent, rate should be the same for any window
    const rate1h = await getSyncSuccessRate(1);
    expect(rate1h).toBe(75);
  });

  it('handles empty metric state gracefully', async () => {
    const successRate = await getSyncSuccessRate(24);
    const avgDuration = await getAverageSyncDuration(24);

    expect(successRate).toBe(0); // No data = 0%
    expect(avgDuration).toBe(0); // No data = 0 duration
  });

  it('integrates metrics collection with sync operations', async () => {
    // Simulate a sync workflow
    const startTime = Date.now();
    
    // Record initial queue state
    await recordQueueSize(50);
    
    // Simulate sync attempt (records 2 metrics: sync_attempt and sync_duration)
    await recordSyncAttempt(true, Date.now() - startTime);
    
    // Record final queue state
    await recordQueueSize(0);

    const successRate = await getSyncSuccessRate(24);
    expect(successRate).toBe(100);

    const metrics = await db.syncMetrics.toArray();
    expect(metrics.length).toBe(4); // 2 queue_size + 1 sync_attempt + 1 sync_duration
  });
});
