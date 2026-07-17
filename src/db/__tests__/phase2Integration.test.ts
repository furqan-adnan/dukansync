import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db, type SyncQueueItem } from '../db';
import { processSyncQueue, verifyQueueIntegrity } from '../syncEngine';
import { supabase } from '../supabaseClient';

vi.mock('../supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
      delete: vi.fn(() => Promise.resolve({ error: null })),
    })),
    rpc: vi.fn(),
  },
}));

describe('Phase 2 Integration', () => {
  beforeEach(async () => {
    vi.stubGlobal('setTimeout', (cb: any) => cb());
    await db.syncQueue.clear();
    await db.deadLetterQueue.clear();
    await db.syncCheckpoints.clear();
    await db.sales.clear();
    await db.products.clear();
    await db.auditLogs.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles large queue with checkpoints and exponential backoff', async () => {
    // Force sequential
    (supabase.functions.invoke as any).mockResolvedValue({ error: new Error('Batch down') });

    for (let i = 1; i <= 20; i++) {
      await db.syncQueue.add({
        entity: 'products',
        entity_id: `prod-${i}`,
        operation: 'INSERT',
        payload: { id: `prod-${i}`, price: 100, updated_at: Date.now() },
        timestamp: Date.now() + i,
        device_id: 'dev-1',
        idempotency_key: `key-${i}`,
        attempt_count: 0
      } as SyncQueueItem);
    }

    let callCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'syncCheckpoints') {
        return { upsert: vi.fn(() => Promise.resolve({ error: null })) };
      }
      return {
        upsert: vi.fn(() => {
          callCount++;
          // Fail 5 times for item 15 (calls 15-19) to trigger DLQ
          if (callCount >= 15 && callCount <= 19) {
             return Promise.resolve({ error: new Error('Simulated network timeout') });
          }
          return Promise.resolve({ error: null });
        }),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => Promise.resolve({ data: [], error: null }))
      };
    });

    await processSyncQueue();

    // Call count will be 14 successful + 5 failed retries on item 15 + 5 successful (16-20)
    expect(callCount).toBeGreaterThan(14);
    
    // Check all DLQ items (not just unresolved) to verify item was moved
    const allDlqItems = await db.deadLetterQueue.toArray();
    expect(allDlqItems.length).toBe(1);
    expect(allDlqItems[0].original_queue_item.entity_id).toBe('prod-15');
    expect(allDlqItems[0].resolved).toBe(false);
  });

  it('detects and reports queue corruption on startup', async () => {
    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'prod-orphaned',
      operation: 'UPDATE',
      payload: { id: 'prod-orphaned' },
      timestamp: Date.now(),
      device_id: 'dev-1',
      idempotency_key: 'key-duplicate', // Duplicate
      attempt_count: 15 // Excessive
    } as SyncQueueItem);

    await db.syncQueue.add({
      entity: 'sales',
      entity_id: 'sale-stale',
      operation: 'INSERT',
      payload: { id: 'sale-stale' },
      timestamp: Date.now() - 90000000, // Stale
      device_id: 'dev-1',
      idempotency_key: 'key-duplicate', // Duplicate
      attempt_count: 0
    } as SyncQueueItem);

    const integrity = await verifyQueueIntegrity();
    
    expect(integrity.isValid).toBe(false);
    expect(integrity.issues.length).toBeGreaterThan(0);
    expect(integrity.issues.some(i => i.includes('Orphaned'))).toBe(true);
    expect(integrity.issues.some(i => i.includes('stale'))).toBe(true);
    expect(integrity.issues.some(i => i.includes('retry attempts'))).toBe(true);
    expect(integrity.issues.some(i => i.includes('Duplicate idempotency key'))).toBe(true);
  });
});
