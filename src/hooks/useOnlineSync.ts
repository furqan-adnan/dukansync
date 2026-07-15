import { useEffect, useRef } from 'react';
import { processSyncQueue } from '../db/syncEngine';

/**
 * Listens for network reconnection and auto-drains the sync queue.
 * Implements project plan §3.4 step 1: sync when device comes back online.
 */
export function useOnlineSync(onSyncComplete?: (processed: number) => void) {
  const syncingRef = useRef(false);

  useEffect(() => {
    async function handleOnline() {
      if (syncingRef.current || !navigator.onLine) return;

      syncingRef.current = true;
      try {
        console.info('[Sync] Network restored — auto-draining queue...');
        const result = await processSyncQueue();
        onSyncComplete?.(result.processedCount);
      } catch (err) {
        console.error('[Sync] Auto-sync failed:', err);
      } finally {
        syncingRef.current = false;
      }
    }

    window.addEventListener('online', handleOnline);

    if (navigator.onLine) {
      void handleOnline();
    }

    return () => window.removeEventListener('online', handleOnline);
  }, [onSyncComplete]);
}
