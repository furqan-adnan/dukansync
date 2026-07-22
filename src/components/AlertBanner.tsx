import { useEffect, useState } from 'react';
import { getPendingQueueCount } from '../db/syncEngine';
import { getDeadLetterStats } from '../db/deadLetterService';
import { getSyncSuccessRate } from '../db/metricsService';
import { checkAlerts, type ActiveAlert, formatAlertMessage } from '../db/alertConfig';

interface AlertBannerProps {
  className?: string;
  onDismiss?: (alert: ActiveAlert) => void;
}

export function AlertBanner({ className = '', onDismiss }: AlertBannerProps) {
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  useEffect(() => {
    const checkForAlerts = async () => {
      try {
        const [queueCount, dlqStats, successRate] = await Promise.all([
          getPendingQueueCount(),
          getDeadLetterStats(),
          getSyncSuccessRate(24),
        ]);

        const metrics = {
          queue_size: queueCount,
          dlq_count: dlqStats.unresolved,
          sync_failure_rate: successRate,
          offline_duration: navigator.onLine ? 0 : Date.now(), // Simplified offline tracking
        };

        const activeAlerts = checkAlerts(metrics);
        
        // Filter out dismissed alerts
        const nonDismissed = activeAlerts.filter(
          alert => !dismissedAlerts.has(`${alert.metric}_${alert.severity}`)
        );
        
        setAlerts(nonDismissed);
      } catch (error) {
        console.error('Failed to check alerts:', error);
      }
    };

    checkForAlerts();
    const interval = setInterval(checkForAlerts, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [dismissedAlerts]);

  const handleDismiss = (alert: ActiveAlert) => {
    setDismissedAlerts(prev => new Set([...prev, `${alert.metric}_${alert.severity}`]));
    onDismiss?.(alert);
  };

  const getAlertStyles = (severity: ActiveAlert['severity']) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 border-red-400 text-red-700';
      case 'warning':
        return 'bg-yellow-100 border-yellow-400 text-yellow-700';
      case 'info':
        return 'bg-blue-100 border-blue-400 text-blue-700';
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      {alerts.map((alert, index) => (
        <div
          key={`${alert.metric}_${alert.severity}_${index}`}
          className={`px-4 py-3 rounded relative border shadow-sm ${getAlertStyles(alert.severity)}`}
          role="alert"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="font-bold">
                {alert.severity === 'critical' && 'Critical Alert'}
                {alert.severity === 'warning' && 'Warning'}
                {alert.severity === 'info' && 'Information'}
              </p>
              <p className="text-sm">{formatAlertMessage(alert)}</p>
            </div>
            <button
              onClick={() => handleDismiss(alert)}
              className="ml-4 text-current opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
