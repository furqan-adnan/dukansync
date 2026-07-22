export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertThreshold {
  metric: string;
  warning: number;
  critical: number;
  enabled: boolean;
}

export interface AlertConfig {
  queueSize: AlertThreshold;
  dlqCount: AlertThreshold;
  syncFailureRate: AlertThreshold;
  offlineDuration: AlertThreshold;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  queueSize: {
    metric: 'queue_size',
    warning: 50,
    critical: 100,
    enabled: true,
  },
  dlqCount: {
    metric: 'dlq_count',
    warning: 5,
    critical: 10,
    enabled: true,
  },
  syncFailureRate: {
    metric: 'sync_failure_rate',
    warning: 10, // 10%
    critical: 25, // 25%
    enabled: true,
  },
  offlineDuration: {
    metric: 'offline_duration',
    warning: 30 * 60 * 1000, // 30 minutes
    critical: 2 * 60 * 60 * 1000, // 2 hours
    enabled: true,
  },
};

/**
 * Gets the alert severity for a given metric value.
 */
export function getAlertSeverity(
  metric: keyof AlertConfig,
  value: number,
  config: AlertConfig = DEFAULT_ALERT_CONFIG
): AlertSeverity | null {
  const threshold = config[metric];
  if (!threshold.enabled) return null;

  if (value >= threshold.critical) return 'critical';
  if (value >= threshold.warning) return 'warning';
  return null;
}

/**
 * Checks all metrics against thresholds and returns active alerts.
 */
export interface ActiveAlert {
  metric: string;
  severity: AlertSeverity;
  value: number;
  threshold: number;
  message: string;
}

export function checkAlerts(
  metrics: Record<string, number>,
  config: AlertConfig = DEFAULT_ALERT_CONFIG
): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];

  // Check queue size
  const queueSeverity = getAlertSeverity('queueSize', metrics.queue_size || 0, config);
  if (queueSeverity) {
    alerts.push({
      metric: 'queue_size',
      severity: queueSeverity,
      value: metrics.queue_size || 0,
      threshold: queueSeverity === 'critical' ? config.queueSize.critical : config.queueSize.warning,
      message: `Sync queue has ${metrics.queue_size} pending items`,
    });
  }

  // Check DLQ count
  const dlqSeverity = getAlertSeverity('dlqCount', metrics.dlq_count || 0, config);
  if (dlqSeverity) {
    alerts.push({
      metric: 'dlq_count',
      severity: dlqSeverity,
      value: metrics.dlq_count || 0,
      threshold: dlqSeverity === 'critical' ? config.dlqCount.critical : config.dlqCount.warning,
      message: `Dead Letter Queue has ${metrics.dlq_count} unresolved items`,
    });
  }

  // Check sync failure rate
  const failureSeverity = getAlertSeverity('syncFailureRate', metrics.sync_failure_rate || 0, config);
  if (failureSeverity) {
    alerts.push({
      metric: 'sync_failure_rate',
      severity: failureSeverity,
      value: metrics.sync_failure_rate || 0,
      threshold: failureSeverity === 'critical' ? config.syncFailureRate.critical : config.syncFailureRate.warning,
      message: `Sync failure rate is ${metrics.sync_failure_rate.toFixed(1)}%`,
    });
  }

  // Check offline duration
  const offlineSeverity = getAlertSeverity('offlineDuration', metrics.offline_duration || 0, config);
  if (offlineSeverity) {
    const offlineMinutes = Math.floor((metrics.offline_duration || 0) / 60000);
    alerts.push({
      metric: 'offline_duration',
      severity: offlineSeverity,
      value: metrics.offline_duration || 0,
      threshold: offlineSeverity === 'critical' ? config.offlineDuration.critical : config.offlineDuration.warning,
      message: `Device has been offline for ${offlineMinutes} minutes`,
    });
  }

  return alerts;
}

/**
 * Formats an alert message for display.
 */
export function formatAlertMessage(alert: ActiveAlert): string {
  const severityPrefix = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
  return `${severityPrefix} ${alert.message}`;
}
