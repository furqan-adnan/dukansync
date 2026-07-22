import { recordNetworkQuality, getCurrentNetworkQuality } from './metricsService';

export type NetworkQuality = 'excellent' | 'good' | 'poor' | 'offline';

export interface NetworkQualityMeasurement {
  quality: NetworkQuality;
  latencyMs: number;
  packetLoss: number;
  timestamp: number;
}

const QUALITY_THRESHOLD = {
  EXCELLENT_LATENCY: 100, // ms
  GOOD_LATENCY: 300, // ms
  POOR_LATENCY: 1000, // ms
  EXCELLENT_PACKET_LOSS: 0.01, // 1%
  GOOD_PACKET_LOSS: 0.05, // 5%
  POOR_PACKET_LOSS: 0.15, // 15%
};

/**
 * Measures network latency by making a lightweight HTTP request.
 */
async function measureLatency(): Promise<number> {
  const start = performance.now();
  
  try {
    // Use a simple fetch to measure latency without requiring custom DB function
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 5000)
    );
    
    // Fetch a small resource (Supabase health check or similar)
    await Promise.race([
      fetch('https://www.google.com/favicon.ico', { 
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store'
      }),
      timeoutPromise
    ]);
    
    return performance.now() - start;
  } catch (error) {
    // If fetch fails, assume very poor connectivity
    return 9999;
  }
}

/**
 * Estimates packet loss by measuring failed requests.
 */
async function measurePacketLoss(): Promise<number> {
  const attempts = 5;
  let failures = 0;

  for (let i = 0; i < attempts; i++) {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 2000)
      );
      
      await Promise.race([
        fetch('https://www.google.com/favicon.ico', { 
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store'
        }),
        timeoutPromise
      ]);
    } catch (error) {
      failures++;
    }
  }

  return failures / attempts;
}

/**
 * Determines network quality based on latency and packet loss.
 */
function determineQuality(latencyMs: number, packetLoss: number): NetworkQuality {
  if (!navigator.onLine) return 'offline';
  
  if (latencyMs <= QUALITY_THRESHOLD.EXCELLENT_LATENCY && 
      packetLoss <= QUALITY_THRESHOLD.EXCELLENT_PACKET_LOSS) {
    return 'excellent';
  }
  
  if (latencyMs <= QUALITY_THRESHOLD.GOOD_LATENCY && 
      packetLoss <= QUALITY_THRESHOLD.GOOD_PACKET_LOSS) {
    return 'good';
  }
  
  if (latencyMs <= QUALITY_THRESHOLD.POOR_LATENCY && 
      packetLoss <= QUALITY_THRESHOLD.POOR_PACKET_LOSS) {
    return 'poor';
  }
  
  return 'offline';
}

/**
 * Converts network quality to a numeric score (0-100) for metrics.
 */
function qualityToScore(quality: NetworkQuality): number {
  switch (quality) {
    case 'excellent': return 100;
    case 'good': return 75;
    case 'poor': return 50;
    case 'offline': return 0;
  }
}

/**
 * Performs a comprehensive network quality measurement.
 */
export async function measureNetworkQuality(): Promise<NetworkQualityMeasurement> {
  const [latencyMs, packetLoss] = await Promise.all([
    measureLatency(),
    measurePacketLoss(),
  ]);

  const quality = determineQuality(latencyMs, packetLoss);
  const measurement: NetworkQualityMeasurement = {
    quality,
    latencyMs,
    packetLoss,
    timestamp: Date.now(),
  };

  // Record the measurement
  await recordNetworkQuality(qualityToScore(quality), latencyMs);

  return measurement;
}

/**
 * Gets the current network quality (cached from latest measurement).
 */
export async function getCurrentNetworkQualityMeasurement(): Promise<NetworkQualityMeasurement | null> {
  const score = await getCurrentNetworkQuality();
  if (score === null) return null;

  // Convert score back to quality
  let quality: NetworkQuality;
  if (score >= 90) quality = 'excellent';
  else if (score >= 70) quality = 'good';
  else if (score >= 50) quality = 'poor';
  else quality = 'offline';

  return {
    quality,
    latencyMs: 0, // Not stored in metrics
    packetLoss: 0, // Not stored in metrics
    timestamp: Date.now(),
  };
}

/**
 * Gets signal strength bars (1-4) based on quality.
 */
export function getSignalStrengthBars(quality: NetworkQuality): number {
  switch (quality) {
    case 'excellent': return 4;
    case 'good': return 3;
    case 'poor': return 2;
    case 'offline': return 1;
  }
}

/**
 * Starts periodic network quality monitoring (every 30 seconds).
 */
let monitoringInterval: number | null = null;

export function startNetworkQualityMonitoring(): void {
  if (monitoringInterval !== null) return; // Already running

  // Initial measurement
  measureNetworkQuality().catch(console.error);

  // Periodic measurements
  monitoringInterval = window.setInterval(() => {
    measureNetworkQuality().catch(console.error);
  }, 30000); // 30 seconds
}

/**
 * Stops network quality monitoring.
 */
export function stopNetworkQualityMonitoring(): void {
  if (monitoringInterval !== null) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

/**
 * Gets network quality history for charts.
 */
export async function getNetworkQualityHistory(hours: number = 24): Promise<{ timestamp: number; quality: number }[]> {
  const { getMetricsInTimeWindow } = await import('./metricsService');
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const metrics = await getMetricsInTimeWindow('network_quality', startTime);
  
  return metrics.map((m) => ({
    timestamp: m.timestamp,
    quality: m.value,
  }));
}
