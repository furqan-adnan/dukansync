import { db, type Product } from './db';
import { getCachedProfile } from './authService';
import { getDeviceId } from './deviceId';
import { logAuditAction } from './auditService';

/**
 * Adjusts product stock locally and queues an UPDATE for sync.
 * Used for restocking and manual inventory corrections.
 */
export async function adjustStock(
  productId: string,
  delta: number,
  reason: string
): Promise<void> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error('Cannot adjust stock: No active user profile.');

  const timestamp = Date.now();

  await db.transaction('rw', [db.products, db.syncQueue], async () => {
    const product = await db.products.get(productId);
    if (!product) throw new Error(`Product ${productId} not found.`);

    const newStock = product.stock + delta;
    if (newStock < 0) {
      throw new Error(`Cannot reduce ${product.name} below zero. Current: ${product.stock}`);
    }

    const updatedProduct: Product = {
      ...product,
      stock: newStock,
      updated_at: timestamp,
      version: product.version + 1,
      sync_status: 'pending',
    };

    await db.products.update(productId, {
      stock: newStock,
      updated_at: timestamp,
      version: updatedProduct.version,
      sync_status: 'pending',
    });

    await db.syncQueue.add({
      entity: 'products',
      entity_id: productId,
      operation: 'UPDATE',
      payload: updatedProduct,
      timestamp,
      device_id: getDeviceId(),
    });
  });

  await logAuditAction('stock_adjusted', { productId, delta, reason });
}
