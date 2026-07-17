import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../db';
import { processSyncQueue } from '../syncEngine';
import { supabase } from '../supabaseClient';

vi.mock('../supabaseClient', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(() => ({
      upsert: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn()
        }))
      }))
    })),
    rpc: vi.fn()
  }
}));

vi.mock('../deviceId', () => ({
  getDeviceId: () => 'test_device'
}));

describe('Sync Engine - Phase 1 Data Safety', () => {
  beforeEach(async () => {
    vi.stubGlobal('setTimeout', (cb: any) => cb());
    await db.syncQueue.clear();
    await db.deadLetterQueue.clear();
    await db.sales.clear();
    await db.products.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('orders queue items chronologically by timestamp, preserving event sourcing order', async () => {
    // Add item 1 with newer timestamp (simulate race condition during local DB insert)
    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'prod_B',
      operation: 'UPDATE',
      payload: {},
      timestamp: 2000,
      device_id: 'dev1',
      idempotency_key: 'key2',
      attempt_count: 0
    });

    // Add item 2 with older timestamp
    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'prod_A',
      operation: 'INSERT',
      payload: {},
      timestamp: 1000,
      device_id: 'dev1',
      idempotency_key: 'key1',
      attempt_count: 0
    });

    // Mock successful batch sync
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: { processed: 2, conflicts: [], authoritative: {} },
      error: null
    } as any);

    await processSyncQueue();

    const calls = vi.mocked(supabase.functions.invoke).mock.calls;
    expect(calls.length).toBe(1);
    
    const body = calls[0][1]?.body as any;
    expect(body.operations.length).toBe(2);
    
    // Older timestamp (prod_A) should be processed first, despite being added second
    expect(body.operations[0].entity_id).toBe('prod_A');
    expect(body.operations[1].entity_id).toBe('prod_B');
  });

  it('moves items to DLQ after 5 retries and reports success', async () => {
    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'prod_A',
      operation: 'INSERT',
      payload: { id: 'prod_A', updated_at: 1000 },
      timestamp: 1000,
      device_id: 'dev1',
      idempotency_key: 'key1',
      attempt_count: 0
    });

    // Batch fails
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: new Error('Batch down') } as any);

    // Sequential fails repeatedly
    const fromMock = vi.mocked(supabase.from);
    fromMock.mockImplementation(() => ({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'Network Timeout' } }),
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn() }) })
    }) as any);

    const result = await processSyncQueue();

    // Sync is successful because queue was drained (item moved to DLQ)
    expect(result.success).toBe(true);

    // Item should be in DLQ, not in sync queue
    const queue = await db.syncQueue.toArray();
    expect(queue.length).toBe(0);

    const dlq = await db.deadLetterQueue.toArray();
    expect(dlq.length).toBe(1);
    expect(dlq[0].failure_reason).toContain('Network Timeout');
    expect(dlq[0].resolved).toBe(false);
  });

  it('deletes items from queue ONLY after successful 200 OK confirmation', async () => {
    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'prod_A',
      operation: 'INSERT',
      payload: { id: 'prod_A', updated_at: 1000 },
      timestamp: 1000,
      device_id: 'dev1',
      idempotency_key: 'key1',
      attempt_count: 0
    });

    // Force sequential by making batch fail
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: new Error('Batch down') } as any);

    // Succeeds on first attempt
    const upsertMock = vi.fn().mockResolvedValueOnce({ error: null });

    vi.mocked(supabase.from).mockImplementation(() => ({
      upsert: upsertMock,
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn() }) })
    }) as any);

    const result = await processSyncQueue();

    expect(result.success).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);

    const queue = await db.syncQueue.toArray();
    expect(queue.length).toBe(0); // Safely deleted
  });
});
