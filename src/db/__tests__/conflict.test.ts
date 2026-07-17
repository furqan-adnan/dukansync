import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db';
import { getConflictedSales, acknowledgeConflict, getConflictDetails } from '../conflictService';

vi.mock('../auditService', () => ({
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

describe('THE CONFLICT RESOLUTION TEST (Conflict Service)', () => {
  beforeEach(async () => {
    await db.sales.clear();
    await db.products.clear();
  });

  it('Flags the change when local and cloud states conflict', async () => {
    // 1. Simulate a sale record that Supabase RPC flagged as 'conflict'
    const conflictSale = {
      id: 'conflict-sale-1',
      tenant_id: 'test-tenant',
      store_id: 'test-store',
      updated_at: Date.now(),
      version: 1,
      sync_status: 'conflict' as const,
      deleted_at: null,
      items: [{ productId: 'prod-1', quantity: 2, priceAtSale: 100 }],
      total: 200,
    };

    await db.sales.add(conflictSale);

    // 2. Verify getConflictedSales surfaces this record for the ConflictPanel UI
    const conflicts = await getConflictedSales();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].sync_status).toBe('conflict');
    expect(conflicts[0].id).toBe('conflict-sale-1');
  });

  it('Properly generates conflict details for the ConflictPanel UI', async () => {
    const conflictSale = {
      id: 'conflict-sale-2',
      tenant_id: 'test-tenant',
      store_id: 'test-store',
      updated_at: Date.now(),
      version: 1,
      sync_status: 'conflict' as const,
      deleted_at: null,
      items: [{ productId: 'prod-1', quantity: 2, priceAtSale: 100 }],
      total: 200,
    };

    const product = {
      id: 'prod-1',
      name: 'Test Product',
      tenant_id: 'test-tenant',
      barcode: null,
      price: 150, // Cloud price differs from priceAtSale!
      stock: 5,
      updated_at: Date.now(),
      version: 2,
      sync_status: 'synced' as const,
      deleted_at: null,
    };

    const details = getConflictDetails(conflictSale, [product]);
    
    // UI should receive precise details of the mismatch to present "Keep Local" / "Overwrite"
    expect(details[0].productName).toBe('Test Product');
    expect(details[0].priceAtSale).toBe(100);
    expect(details[0].currentStock).toBe(5);
  });

  it('Resolves and acknowledges the conflict state successfully', async () => {
    const conflictSale = {
      id: 'conflict-sale-3',
      tenant_id: 'test-tenant',
      store_id: 'test-store',
      updated_at: Date.now(),
      version: 1,
      sync_status: 'conflict' as const,
      deleted_at: null,
      items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 100 }],
      total: 100,
    };

    await db.sales.add(conflictSale);

    // Act: Acknowledge the conflict (simulate user clicking resolve in ConflictPanel)
    await acknowledgeConflict('conflict-sale-3');

    // Assert
    const updatedSale = await db.sales.get('conflict-sale-3');
    expect(updatedSale?.sync_status).toBe('synced');
    
    const remainingConflicts = await getConflictedSales();
    expect(remainingConflicts.length).toBe(0);
  });
});
