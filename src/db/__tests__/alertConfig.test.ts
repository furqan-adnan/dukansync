import { describe, it, expect } from 'vitest';
import {
  getAlertSeverity,
  checkAlerts,
  formatAlertMessage,
  DEFAULT_ALERT_CONFIG,
} from '../alertConfig';

describe('Alert Config', () => {
  it('returns null when threshold is disabled', () => {
    const config = {
      ...DEFAULT_ALERT_CONFIG,
      queueSize: { ...DEFAULT_ALERT_CONFIG.queueSize, enabled: false },
    };

    const severity = getAlertSeverity('queueSize', 100, config);
    expect(severity).toBeNull();
  });

  it('returns critical severity when value exceeds critical threshold', () => {
    const severity = getAlertSeverity('queueSize', 150, DEFAULT_ALERT_CONFIG);
    expect(severity).toBe('critical');
  });

  it('returns warning severity when value exceeds warning but not critical threshold', () => {
    const severity = getAlertSeverity('queueSize', 75, DEFAULT_ALERT_CONFIG);
    expect(severity).toBe('warning');
  });

  it('returns null when value is below warning threshold', () => {
    const severity = getAlertSeverity('queueSize', 25, DEFAULT_ALERT_CONFIG);
    expect(severity).toBeNull();
  });

  it('checks queue size alerts correctly', () => {
    const metrics = { queue_size: 60, dlq_count: 0, sync_failure_rate: 0, offline_duration: 0 };
    const alerts = checkAlerts(metrics);

    expect(alerts.length).toBe(1);
    expect(alerts[0].metric).toBe('queue_size');
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].value).toBe(60);
  });

  it('checks DLQ count alerts correctly', () => {
    const metrics = { queue_size: 0, dlq_count: 7, sync_failure_rate: 0, offline_duration: 0 };
    const alerts = checkAlerts(metrics);

    expect(alerts.length).toBe(1);
    expect(alerts[0].metric).toBe('dlq_count');
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].value).toBe(7);
  });

  it('checks sync failure rate alerts correctly', () => {
    const metrics = { queue_size: 0, dlq_count: 0, sync_failure_rate: 15, offline_duration: 0 };
    const alerts = checkAlerts(metrics);

    expect(alerts.length).toBe(1);
    expect(alerts[0].metric).toBe('sync_failure_rate');
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].value).toBe(15);
  });

  it('checks offline duration alerts correctly', () => {
    const metrics = { queue_size: 0, dlq_count: 0, sync_failure_rate: 0, offline_duration: 45 * 60 * 1000 };
    const alerts = checkAlerts(metrics);

    expect(alerts.length).toBe(1);
    expect(alerts[0].metric).toBe('offline_duration');
    expect(alerts[0].severity).toBe('warning');
  });

  it('returns multiple alerts when multiple thresholds are exceeded', () => {
    const metrics = {
      queue_size: 120,
      dlq_count: 12,
      sync_failure_rate: 30,
      offline_duration: 3 * 60 * 60 * 1000,
    };
    const alerts = checkAlerts(metrics);

    expect(alerts.length).toBe(4);
    expect(alerts.every(alert => alert.severity === 'critical')).toBe(true);
  });

  it('returns no alerts when all metrics are within thresholds', () => {
    const metrics = {
      queue_size: 10,
      dlq_count: 2,
      sync_failure_rate: 5,
      offline_duration: 10 * 60 * 1000,
    };
    const alerts = checkAlerts(metrics);

    expect(alerts.length).toBe(0);
  });

  it('formats alert message for critical severity', () => {
    const alert = {
      metric: 'queue_size',
      severity: 'critical' as const,
      value: 150,
      threshold: 100,
      message: 'Sync queue has 150 pending items',
    };

    const formatted = formatAlertMessage(alert);
    expect(formatted).toBe('🚨 Sync queue has 150 pending items');
  });

  it('formats alert message for warning severity', () => {
    const alert = {
      metric: 'dlq_count',
      severity: 'warning' as const,
      value: 7,
      threshold: 5,
      message: 'Dead Letter Queue has 7 unresolved items',
    };

    const formatted = formatAlertMessage(alert);
    expect(formatted).toBe('⚠️ Dead Letter Queue has 7 unresolved items');
  });

  it('formats alert message for info severity', () => {
    const alert = {
      metric: 'sync_failure_rate',
      severity: 'info' as const,
      value: 8,
      threshold: 10,
      message: 'Sync failure rate is 8.0%',
    };

    const formatted = formatAlertMessage(alert);
    expect(formatted).toBe('ℹ️ Sync failure rate is 8.0%');
  });

  it('uses custom config when provided', () => {
    const customConfig = {
      ...DEFAULT_ALERT_CONFIG,
      queueSize: { ...DEFAULT_ALERT_CONFIG.queueSize, warning: 200, critical: 500 },
    };

    const severity = getAlertSeverity('queueSize', 250, customConfig);
    expect(severity).toBe('warning');
  });
});
