import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db';
import { checkoutLocalSale } from '../salesService';
import { createLocalProduct } from '../productsService';
import { processSyncQueue } from '../syncEngine';
import { supabase } from '../supabaseClient';
import { getCachedProfile } from '../authService';
import { getActiveStoreId } from '../storesService';

vi.mock('../supabaseClient', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(() => ({
      upsert: vi.fn(),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn()
        }))
      }))
    })),
    rpc: vi.fn()
  }
}));

vi.mock('../authService', () => ({
  getCachedProfile: vi.fn()
}));

vi.mock('../storesService', () => ({
  getActiveStoreId: vi.fn()
}));

describe('Phase 1 Integration - End-to-End Sync', () => {
  beforeEach(async () => {
    await db.syncQueue.clear();
    await db.sales.clear();
    await db.products.clear();
    vi.clearAllMocks();

    vi.mocked(getCachedProfile).mockResolvedValue({
      id: 'user_1',
      tenant_id: 'tenant_1',
      role: 'owner'
    } as any);
    vi.mocked(getActiveStoreId).mockResolvedValue('store_1');
  });

  it('preserves idempotency keys across service layers and sync engine', async () => {
    // 1. Create a product through the service layer
    await createLocalProduct('Apple', '123', 5.0, 100);

    // 2. Perform a checkout through the service layer
    const products = await db.products.toArray();
    const prodId = products[0].id;
    await checkoutLocalSale([{ productId: prodId, quantity: 2 }]);

    // 3. Verify queue was populated with idempotency keys
    const queue = await db.syncQueue.toArray();
    expect(queue.length).toBe(2);
    expect(queue[0].idempotency_key).toBeDefined();
    expect(queue[1].idempotency_key).toBeDefined();

    // 4. Force a sync with simulated network drops
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: new Error('Batch failed') } as any);

    const rpcMock = vi.fn().mockResolvedValueOnce({ data: { success: true }, error: null });
    vi.mocked(supabase.rpc).mockImplementation(rpcMock as any);

    const upsertMock = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'Timeout' } }) // Fails product insert 1st time
      .mockResolvedValueOnce({ error: null }); // Succeeds product insert 2nd time

    vi.mocked(supabase.from).mockImplementation(() => ({
      upsert: upsertMock,
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn() }) })
    }) as any);

    // Execute the sync
    const result = await processSyncQueue();
    expect(result.success).toBe(true);

    // Verifications:
    // Product should have been retried automatically
    expect(upsertMock).toHaveBeenCalledTimes(2);

    // Sales RPC should be called once with idempotency key inside payload
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const rpcPayload = rpcMock.mock.calls[0][1] as any;
    expect(rpcPayload.sale_payload.idempotency_key).toBe(queue[1].idempotency_key);

    // Queue should be clean, having safely processed all intents
    const endQueue = await db.syncQueue.toArray();
    expect(endQueue.length).toBe(0);
  });
});
