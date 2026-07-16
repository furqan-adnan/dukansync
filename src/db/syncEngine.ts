import { db, type Product, type Sale, type SyncQueueItem, type AuditLog } from './db';
import { supabase } from './supabaseClient';
import { getDeviceId } from './deviceId';

interface SyncResponse {
  success: boolean;
  processedCount: number;
  error?: string;
}

interface BatchSyncResult {
  processed: number;
  conflicts: string[];
  authoritative: {
    products: Array<Record<string, unknown>>;
    sales: Array<Record<string, unknown>>;
  };
}

let isSyncing = false;

export async function getPendingQueueCount(): Promise<number> {
  return await db.syncQueue.count();
}

export async function processSyncQueue(): Promise<SyncResponse> {
  if (isSyncing) {
    console.warn('Sync Engine: Sync already in progress, ignoring duplicate trigger.');
    return { success: true, processedCount: 0 };
  }

  isSyncing = true;
  try {
    const queue = await db.syncQueue.orderBy('id').toArray();

    if (queue.length === 0) {
      console.log('Sync Engine: Queue is completely clean. No pending events.');
      try {
        await pullLatestStateFromCloud();
      } catch (err: unknown) {
        return { success: false, processedCount: 0, error: getErrorMessage(err) };
      }
      return { success: true, processedCount: 0 };
    }

    console.log(`Sync Engine: Commencing batch upload for ${queue.length} pending events...`);

    // Try unified /sync endpoint first (project plan §3.4)
    const batchResult = await tryBatchSync(queue);
    if (batchResult) {
      return batchResult;
    }

    // Fallback: sequential per-item push
    return await sequentialPush(queue);
  } finally {
    isSyncing = false;
  }
}

async function tryBatchSync(queue: SyncQueueItem[]): Promise<SyncResponse | null> {
  try {
    const operations = queue.map(({ entity, entity_id, operation, payload, timestamp, device_id }) => ({
      entity,
      entity_id,
      operation,
      payload,
      timestamp,
      device_id,
    }));

    const { data, error } = await supabase.functions.invoke('sync', {
      body: { operations, device_id: getDeviceId() },
    });

    if (error) {
      console.warn('Sync Engine: /sync endpoint unavailable, falling back to sequential push.', error);
      return null;
    }

    const result = data as BatchSyncResult;
    let processedCount = 0;

    // Handle conflicts and drain queue
    const conflictSet = new Set(result.conflicts ?? []);

    for (const item of queue) {
      if (conflictSet.has(item.entity_id)) {
        await db.sales.update(item.entity_id, { sync_status: 'conflict' });
      } else {
        await markLocalRecordSynced(item);
      }

      if (item.id !== undefined) {
        await db.syncQueue.delete(item.id);
        processedCount++;
      }
    }

    // Merge authoritative state
    await mergeAuthoritativeState(result.authoritative);

    console.log(`Sync Engine: Batch /sync complete. Processed ${processedCount} operations.`);
    return { success: true, processedCount };
  } catch {
    console.warn('Sync Engine: /sync endpoint failed, falling back to sequential push.');
    return null;
  }
}

async function sequentialPush(queue: SyncQueueItem[]): Promise<SyncResponse> {
  let processedCount = 0;

  for (const item of queue) {
    try {
      const { id, entity, operation } = item;
      const result = await pushItemToCloud(item);

      if (result.error) {
        throw new Error(`Cloud rejection on ${entity} [${operation}]: ${result.error.message}`);
      }

      if (result.conflict) {
        console.warn(`Conflict detected for sale ${item.entity_id}. Fixing local stock.`);

        await db.sales.update(item.entity_id, { sync_status: 'conflict' });

        if (result.authoritativeProducts) {
          for (const p of result.authoritativeProducts) {
            await db.products.update(p.id, {
              stock: p.stock,
              sync_status: 'synced',
            });
          }
        }
      } else {
        await markLocalRecordSynced(item);
      }

      if (id !== undefined) {
        await db.syncQueue.delete(id);
        processedCount++;
      }
    } catch (err: unknown) {
      console.error(`Sync Engine stalled at operation ID ${item.id}:`, err);
      return {
        success: false,
        processedCount,
        error: getErrorMessage(err),
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
      error: `Push succeeded, but pull failed: ${getErrorMessage(err)}`,
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
      await mergeProduct(sp);
    }
  }

  const { data: serverSales, error: sError } = await supabase.from('sales').select('*');
  if (sError) {
    console.error('Failed to pull sales:', sError);
    throw sError;
  }

  if (serverSales) {
    for (const ss of serverSales) {
      await mergeSale(ss);
    }
  }

  console.log('Sync Engine: Pull complete.');
}

async function mergeAuthoritativeState(authoritative: BatchSyncResult['authoritative']) {
  for (const sp of authoritative.products ?? []) {
    await mergeProduct(sp);
  }
  for (const ss of authoritative.sales ?? []) {
    await mergeSale(ss);
  }
}

async function mergeProduct(sp: Record<string, unknown>) {
  const localP = await db.products.get(sp.id as string);
  const serverTime = new Date(sp.updated_at as string).getTime();

  if (!localP || localP.sync_status === 'synced' || serverTime > localP.updated_at) {
    await db.products.put({
      id: sp.id as string,
      tenant_id: sp.tenant_id as string,
      store_id: sp.store_id as string,
      name: sp.name as string,
      barcode: (sp.barcode as string) ?? null,
      price: Number(sp.price),
      stock: Number(sp.stock),
      version: Number(sp.version),
      sync_status: 'synced',
      updated_at: serverTime,
      deleted_at: sp.deleted_at ? new Date(sp.deleted_at as string).getTime() : null,
    });
  }
}

async function mergeSale(ss: Record<string, unknown>) {
  const localS = await db.sales.get(ss.id as string);
  const serverTime = new Date(ss.updated_at as string).getTime();

  if (!localS || (localS.sync_status === 'synced' && serverTime >= localS.updated_at)) {
    await db.sales.put({
      id: ss.id as string,
      tenant_id: ss.tenant_id as string,
      store_id: ss.store_id as string,
      items: ss.items as Sale['items'],
      total: Number(ss.total_amount),
      version: Number(ss.version),
      sync_status: (ss.sync_status as Sale['sync_status']) ?? 'synced',
      updated_at: serverTime,
      deleted_at: ss.deleted_at ? new Date(ss.deleted_at as string).getTime() : null,
    });
  }
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

  if (item.entity === 'audit_logs') {
    const payload = await getAuditLogCloudPayload(item);
    const { error } = await supabase.from('audit_logs').insert(payload);
    return { error };
  }

  const payload = await getSaleCloudPayload(item);

  if (item.operation === 'INSERT') {
    const { data, error } = await supabase.rpc('process_sale_with_conflict_check', {
      sale_payload: payload,
    });

    if (error) return { error };

    const rpcResult = data as { sync_status?: string; authoritative_products?: { id: string; stock: number }[] };
    if (rpcResult.sync_status === 'conflict') {
      return {
        conflict: true,
        authoritativeProducts: rpcResult.authoritative_products,
      };
    }

    return { error: null };
  }

  const { error } = await supabase.from('sales').upsert(payload);
  return { error };
}

async function getProductCloudPayload(item: SyncQueueItem) {
  const product = item.payload as Product;

  return {
    id: product.id,
    name: product.name,
    barcode: product.barcode ?? null,
    price: product.price,
    stock: product.stock,
    version: product.version,
    sync_status: 'synced',
    updated_at: new Date(product.updated_at).toISOString(),
    tenant_id: product.tenant_id,
    store_id: product.store_id,
  };
}

async function getSaleCloudPayload(item: SyncQueueItem) {
  const sale = item.payload as Sale;

  return {
    id: sale.id,
    total_amount: sale.total,
    items: sale.items,
    items_count: sale.items.reduce((count, saleItem) => count + saleItem.quantity, 0),
    version: sale.version,
    sync_status: 'synced',
    updated_at: new Date(sale.updated_at).toISOString(),
    tenant_id: sale.tenant_id,
    store_id: sale.store_id,
  };
}

async function getAuditLogCloudPayload(item: SyncQueueItem) {
  const log = item.payload as AuditLog;

  return {
    id: log.id,
    tenant_id: log.tenant_id,
    store_id: log.store_id,
    user_id: log.user_id,
    action_type: log.action_type,
    details: log.details,
    timestamp: log.timestamp,
    version: log.version,
    sync_status: 'synced',
    updated_at: new Date(log.updated_at).toISOString(),
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
    return;
  }

  if (item.entity === 'audit_logs') {
    await db.auditLogs.update(item.entity_id, { sync_status: 'synced' });
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Network frame dropped mid-queue streaming.';
}
