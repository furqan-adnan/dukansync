import { db, type Product } from './db';

// Simple, fast client-side UUID generator for offline isolation
export function generateUUID(): string {
  return crypto.randomUUID();
}

// Temporary hardcoded IDs for our Phase 1 sandbox development
const MOCK_TENANT_ID = 'tenant_01j2x';
const MOCK_STORE_ID = 'store_lahore_01';
const MOCK_DEVICE_ID = 'pos_register_01';

/**
 * Persists a new product locally and registers an event in the sync queue.
 */
export async function createLocalProduct(name: string, barcode: string | null, price: number, stock: number): Promise<string> {
  const productId = generateUUID();
  const timestamp = Date.now();

  const newProduct: Product = {
    id: productId,
    tenant_id: MOCK_TENANT_ID,
    store_id: MOCK_STORE_ID,
    updated_at: timestamp,
    version: 1,
    sync_status: 'pending',
    deleted_at: null,
    name,
    barcode,
    price,
    stock,
  };

  // Perform an atomic database transaction
  await db.transaction('rw', [db.products, db.syncQueue], async () => {
    // 1. Write the current product state to the client database
    await db.products.add(newProduct);

    // 2. Append the operation event to the log queue for eventual backup syncing
    await db.syncQueue.add({
      entity: 'products',
      entity_id: productId,
      operation: 'INSERT',
      payload: newProduct,
      timestamp: timestamp,
      device_id: MOCK_DEVICE_ID,
    });
  });

  return productId;
}

/**
 * Returns all active, non-soft-deleted local records.
 */
export async function getAllLocalProducts(): Promise<Product[]> {
  return await db.products
    .filter(product => product.deleted_at === null)
    .toArray();
}