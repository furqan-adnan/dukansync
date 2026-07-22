import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../db';
import {
  getCurrentNetworkQualityMeasurement,
  getSignalStrengthBars,
  startNetworkQualityMonitoring,
  stopNetworkQualityMonitoring,
  getNetworkQualityHistory,
} from '../networkQualityService';
import { recordNetworkQuality } from '../metricsService';

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe('Network Quality Service', () => {
  beforeEach(async () => {
    await db.syncMetrics.clear();
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stopNetworkQualityMonitoring();
  });

  it('gets signal strength bars for each quality level', () => {
    expect(getSignalStrengthBars('excellent')).toBe(4);
    expect(getSignalStrengthBars('good')).toBe(3);
    expect(getSignalStrengthBars('poor')).toBe(2);
    expect(getSignalStrengthBars('offline')).toBe(1);
  });

  it('gets current network quality measurement from metrics', async () => {
    await recordNetworkQuality(75, 150);

    const measurement = await getCurrentNetworkQualityMeasurement();

    expect(measurement).not.toBeNull();
    expect(measurement?.quality).toBe('good');
  });

  it('returns null when no network quality metrics exist', async () => {
    const measurement = await getCurrentNetworkQualityMeasurement();

    expect(measurement).toBeNull();
  });

  it('starts network quality monitoring', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    startNetworkQualityMonitoring();

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

    intervalSpy.mockRestore();
  });

  it('does not start monitoring if already running', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    startNetworkQualityMonitoring();
    startNetworkQualityMonitoring();

    expect(intervalSpy).toHaveBeenCalledTimes(1);

    intervalSpy.mockRestore();
  });

  it('stops network quality monitoring', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    startNetworkQualityMonitoring();
    stopNetworkQualityMonitoring();

    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });

  it('gets network quality history', async () => {
    await recordNetworkQuality(100, 50);
    await new Promise(resolve => setTimeout(resolve, 10));
    await recordNetworkQuality(75, 150);
    await new Promise(resolve => setTimeout(resolve, 10));
    await recordNetworkQuality(50, 300);

    const history = await getNetworkQualityHistory(24);

    expect(history.length).toBe(3);
    expect(history[0].quality).toBe(100);
    expect(history[1].quality).toBe(75);
    expect(history[2].quality).toBe(50);
  });

  it('returns empty history when no metrics exist', async () => {
    const history = await getNetworkQualityHistory(24);

    expect(history).toEqual([]);
  });
});
