import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db';
import { checkoutLocalSale } from '../salesService';
import { createLocalProduct } from '../productsService';
import { adjustStock } from '../stockService';
import * as authService from '../authService';
import * as storesService from '../storesService';

// Mock the auth and stores services to return dummy data for our tests
vi.mock('../authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../authService')>();
  return {
    ...actual,
    getCachedProfile: vi.fn().mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      tenant_id: 'test-tenant-id',
      role: 'owner',
      created_at: new Date().toISOString()
    }),
  };
});

vi.mock('../storesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storesService')>();
  return {
    ...actual,
    getActiveStoreId: vi.fn().mockResolvedValue('test-store-id'),
  };
});

describe('THE INVENTORY HOOK TEST (Stock Service)', () => {
  beforeEach(async () => {
    // Clear the Dexie database before each test
    await db.sales.clear();
    await db.products.clear();
    await db.syncQueue.clear();
  });

  it('Selling a product reduces its local Dexie stock immediately', async () => {
    // 1. Setup initial product. createLocalProduct returns the ID as a string.
    const productId = await createLocalProduct('Test Product', null, 100, 10);
    
    // 2. Perform a sale of 3 items
    await checkoutLocalSale([{ productId, quantity: 3 }]);
    
    // 3. Verify stock has decremented
    const updatedProduct = await db.products.get(productId);
    expect(updatedProduct).toBeDefined();
    expect(updatedProduct?.stock).toBe(7);
  });

  it('Restocking a product through adjustStock updates the local stock', async () => {
    const productId = await createLocalProduct('Test Product 2', null, 50, 5);
    
    // Adjust stock upwards using the actual stockService
    await adjustStock(productId, 15, 'restock');
    
    const updatedProduct = await db.products.get(productId);
    expect(updatedProduct).toBeDefined();
    expect(updatedProduct?.stock).toBe(20);
  });

  it('Cannot sell a product if its stock is 0 (Negative Stock Protection)', async () => {
    const productId = await createLocalProduct('Test Product 3', null, 200, 0);
    
    // Attempt to sell should throw an error
    await expect(
      checkoutLocalSale([{ productId, quantity: 1 }])
    ).rejects.toThrow(/Insufficient stock/);
    
    // Verify stock remains 0
    const updatedProduct = await db.products.get(productId);
    expect(updatedProduct?.stock).toBe(0);
  });
});
