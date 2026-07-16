import { db, type Sale, type SaleItem } from './db';
import { generateUUID } from './productsService';
import { getCachedProfile } from './authService';
import { getDeviceId } from './deviceId';
import { getActiveStoreId } from './storesService';

/**
 * Processes a checkout transaction completely offline.
 * Decrements inventory stock and logs the sale event atomically.
 */
export async function checkoutLocalSale(cartItems: { productId: string; quantity: number }[]): Promise<string> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error("Cannot process sale: No active user profile.");

  const storeId = await getActiveStoreId();
  if (!storeId) throw new Error("Cannot process sale: No active store selected.");

  const saleId = generateUUID();
  const timestamp = Date.now();
  let grandTotal = 0;
  const processedItems: SaleItem[] = [];

  // Run everything inside an atomic transaction across all three tables
  await db.transaction('rw', [db.sales, db.products, db.syncQueue], async () => {
    
    for (const item of cartItems) {
      // 1. Fetch the product from local IndexedDB to get its latest price and stock
      const product = await db.products.get(item.productId);
      if (!product) throw new Error(`Product with ID ${item.productId} not found.`);
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
      }

      // 2. Calculate totals
      const itemTotal = product.price * item.quantity;
      grandTotal += itemTotal;

      processedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        priceAtSale: product.price
      });

      // 3. Decrement stock locally
      const newStock = product.stock - item.quantity;
      const updatedProduct = {
        ...product,
        stock: newStock,
        updated_at: timestamp,
        version: product.version + 1,
        sync_status: 'pending' as const,
      };

      await db.products.update(item.productId, { 
        stock: newStock,
        updated_at: timestamp, // Track update time for eventual last-write-wins resolution
        version: updatedProduct.version,
        sync_status: 'pending',
      });
    }
    // 4. Create the final structural Sale record
    const newSale: Sale = {
      id: saleId,
      tenant_id: profile.tenant_id,
      store_id: storeId,
      updated_at: timestamp,
      version: 1,
      sync_status: 'pending',
      deleted_at: null,
      items: processedItems,
      total: grandTotal
    };

    // 5. Write to local sales history table
    await db.sales.add(newSale);

    // 6. Push the checkout event to the Sync Queue log
    await db.syncQueue.add({
      entity: 'sales',
      entity_id: saleId,
      operation: 'INSERT',
      payload: newSale,
      timestamp: timestamp,
      device_id: getDeviceId()
    });
  });

  return saleId;
}

/**
 * Retrieves a specific sale by its ID from the local database.
 */
export async function getSaleById(id: string): Promise<Sale | undefined> {
  return await db.sales.get(id);
}

/**
 * Retrieves all locally saved invoices.
 */
export async function getAllLocalSales(): Promise<Sale[]> {
  return await db.sales.toArray();
}
