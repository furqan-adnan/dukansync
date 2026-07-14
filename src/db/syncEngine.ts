import { db, type Product, type Sale, type SyncQueueItem } from './db';
import { supabase } from './supabaseClient';

interface SyncResponse {
  success: boolean;
  processedCount: number;
  error?: string;
}

export async function processSyncQueue(): Promise<SyncResponse> {
  // 1. Fetch all pending operations in chronological order
  const queue = await db.syncQueue.orderBy('id').toArray();

  if (queue.length === 0) {
    console.log('Sync Engine: Queue is completely clean. No pending events.');
    return { success: true, processedCount: 0 };
  }

  console.log(`Sync Engine: Commencing batch upload for ${queue.length} pending events...`);
  let processedCount = 0;

  // 2. Iterate through each log intent sequentially to guarantee order preservation
  for (const item of queue) {
    try {
      const { id, entity, operation } = item;
      const result = await pushItemToCloud(item);

      if (result.error) {
        throw new Error(`Cloud rejection on ${entity} [${operation}]: ${result.error.message}`);
      }

      // 3. Handle conflict resolution for sales
      if (result.conflict) {
        console.warn(`Conflict detected for sale ${item.entity_id}. Fixing local stock.`);
        
        // Update local sale to conflict status
        await db.sales.update(item.entity_id, { sync_status: 'conflict' });
        
        // Revert local stock to authoritative server state
        if (result.authoritativeProducts) {
          for (const p of result.authoritativeProducts) {
            await db.products.update(p.id, { 
              stock: p.stock, 
              sync_status: 'synced' // Server says this is the true stock
            });
          }
        }
      } else {
        // Normal success: mark the local record as synced
        await markLocalRecordSynced(item);
      }

      // 4. Success or handled conflict! Evict the processed intent from local Dexie IndexedDB cache
      if (id !== undefined) {
        await db.syncQueue.delete(id);
        processedCount++;
      }

    } catch (err: unknown) {
      console.error(`Sync Engine stalled at operation ID ${item.id}:`, err);
      
      // CRITICAL FOR DATA INTEGRITY: Return immediately without draining the rest of the queue.
      // This prevents out-of-order execution if item #2 depends on item #1.
      return {
        success: false,
        processedCount,
        error: getErrorMessage(err)
      };
    }
  }

  console.log(`Sync Engine: Queue fully drained. Successfully synchronized ${processedCount} intents.`);
  
  try {
    await pullLatestStateFromCloud();
  } catch (err: unknown) {
    return {
      success: false,
      processedCount,
      error: `Push succeeded, but pull failed: ${getErrorMessage(err)}`
    };
  }

  return { success: true, processedCount };
}

async function pullLatestStateFromCloud() {
  console.log('Sync Engine: Pulling authoritative state from cloud...');
  
  const { data: serverProducts, error: pError } = await supabase.from('products').select('*');
  if (pError) {
    console.error('Failed to pull products:', pError);
    throw pError;
  }
  
  if (serverProducts) {
    for (const sp of serverProducts) {
      const localP = await db.products.get(sp.id);
      const serverTime = new Date(sp.updated_at).getTime();
      
      // Overwrite local if it doesn't exist, OR if local is already synced, OR if server is strictly newer
      if (!localP || localP.sync_status === 'synced' || serverTime > localP.updated_at) {
        await db.products.put({
          id: sp.id,
          tenant_id: sp.tenant_id,
          store_id: sp.store_id,
          name: sp.name,
          barcode: sp.barcode,
          price: sp.price,
          stock: sp.stock,
          version: sp.version,
          sync_status: 'synced',
          updated_at: serverTime,
          deleted_at: sp.deleted_at ? new Date(sp.deleted_at).getTime() : null
        });
      }
    }
  }
  
  console.log('Sync Engine: Pull complete.');
}

interface PushResult {
  error?: { message: string } | null;
  conflict?: boolean;
  authoritativeProducts?: { id: string; stock: number }[];
}

async function pushItemToCloud(item: SyncQueueItem): Promise<PushResult> {
  if (item.operation === 'DELETE') {
    const { error } = await supabase.from(item.entity).delete().eq('id', item.entity_id);
    return { error };
  }

  if (item.entity === 'products') {
    const { error } = await supabase.from('products').upsert(await getProductCloudPayload(item));
    return { error };
  }

  // Handle Sales
  const payload = await getSaleCloudPayload(item);
  
  if (item.operation === 'INSERT') {
    // Route through our atomic RPC to check for negative stock
    const { data, error } = await supabase.rpc('process_sale_with_conflict_check', {
      sale_payload: payload
    });

    if (error) return { error };

    // The RPC returns a custom JSON object indicating success/conflict
    const rpcResult = data as any;
    if (rpcResult.sync_status === 'conflict') {
      return {
        conflict: true,
        authoritativeProducts: rpcResult.authoritative_products
      };
    }

    return { error: null };
  }

  // Fallback for sale updates (if any)
  const { error } = await supabase.from('sales').upsert(payload);
  return { error };
}

async function getProductCloudPayload(item: SyncQueueItem) {
  const latestProduct = await db.products.get(item.entity_id);
  const product = (latestProduct ?? item.payload) as Product;

  return {
    id: product.id,
    name: product.name,
    barcode: product.barcode ?? null,
    price: product.price,
    stock: product.stock,
    version: product.version,
    sync_status: 'synced',
    updated_at: new Date(product.updated_at).toISOString(),
  };
}

async function getSaleCloudPayload(item: SyncQueueItem) {
  const latestSale = await db.sales.get(item.entity_id);
  const sale = (latestSale ?? item.payload) as Sale;

  return {
    id: sale.id,
    total_amount: sale.total,
    items_count: sale.items.reduce((count, saleItem) => count + saleItem.quantity, 0),
    version: sale.version,
    sync_status: 'synced',
    updated_at: new Date(sale.updated_at).toISOString(),
  };
}

async function markLocalRecordSynced(item: SyncQueueItem) {
  if (item.operation === 'DELETE') return;

  if (item.entity === 'products') {
    await db.products.update(item.entity_id, { sync_status: 'synced' });
    return;
  }

  if (item.entity === 'sales') {
    await db.sales.update(item.entity_id, { sync_status: 'synced' });
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return "Network frame dropped mid-queue streaming.";
}
