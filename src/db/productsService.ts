import { db, type Product } from './db';
import { getCachedProfile } from './authService';
import { getDeviceId } from './deviceId';
import { getActiveStoreId } from './storesService';

// Simple, fast client-side UUID generator for offline isolation
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Persists a new product locally and registers an event in the sync queue.
 */
export async function createLocalProduct(name: string, barcode: string | null, price: number, stock: number): Promise<string> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error("Cannot create product: No active user profile.");

  const storeId = await getActiveStoreId();
  if (!storeId) throw new Error("Cannot create product: No active store selected.");

  const productId = generateUUID();
  const timestamp = Date.now();

  const newProduct: Product = {
    id: productId,
    tenant_id: profile.tenant_id,
    store_id: storeId,
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
      device_id: getDeviceId(),
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