import { db, type Product, type Sale, type SyncQueueItem, type AuditLog } from './db';
import { supabase } from './supabaseClient';
import { getDeviceId } from './deviceId';
import { moveToDeadLetterQueue } from './deadLetterService';

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
const SYNC_SESSION_ID = crypto.randomUUID();
const CHECKPOINT_INTERVAL = 10; // Save checkpoint every 10 items

export async function getPendingQueueCount(): Promise<number> {
  return await db.syncQueue.count();
}

export async function processSyncQueue(): Promise<SyncResponse> {
  if (isSyncing) {
    console.warn('Sync Engine: Sync already in progress, ignoring duplicate trigger.');
    return { success: true, processedCount: 0 };
  }

  isSyncing = true;
  let processedCount = 0;
  
  try {
    // Load from checkpoint if exists
    const lastCheckpoint = await db.syncCheckpoints
      .where('sync_session_id')
      .equals(SYNC_SESSION_ID)
      .last();

    let queue = await db.syncQueue.orderBy('timestamp').toArray();

    // Resume from checkpoint
    if (lastCheckpoint) {
      console.log(`Resuming from checkpoint: ${lastCheckpoint.last_processed_queue_id}`);
      queue = queue.filter(item => (item.id || 0) > lastCheckpoint.last_processed_queue_id);
      processedCount = lastCheckpoint.processed_count;
    }

    if (queue.length === 0) {
      console.log('Sync Engine: Queue is completely clean. No pending events.');
      // Clean up old checkpoints from other sessions
      await db.syncCheckpoints
        .where('sync_session_id')
        .notEqual(SYNC_SESSION_ID)
        .delete();
        
      try {
        await pullLatestStateFromCloud();
      } catch (err: unknown) {
        return { success: false, processedCount: 0, error: getErrorMessage(err) };
      }
      return { success: true, processedCount: 0 };
    }

    console.log(`Sync Engine: Commencing batch upload for ${queue.length} pending events...`);

    // If we have a checkpoint, a previous batch failed or we crashed mid-sequential. Skip batch.
    if (!lastCheckpoint) {
      // Try unified /sync endpoint first
      const batchResult = await tryBatchSync(queue);
      if (batchResult) {
        return batchResult;
      }
    }

    // Fallback: sequential per-item push with retries, DLQ, and Checkpoints
    return await sequentialPushWithRetry(queue, processedCount, SYNC_SESSION_ID);
  } finally {
    isSyncing = false;
  }
}

export async function saveCheckpoint(lastProcessedId: number, count: number, sessionId: string): Promise<void> {
  await db.syncCheckpoints.put({
    last_processed_queue_id: lastProcessedId,
    processed_count: count,
    created_at: Date.now(),
    sync_session_id: sessionId
  });
}

async function tryBatchSync(queue: SyncQueueItem[]): Promise<SyncResponse | null> {
  try {
    const operations = queue.map((item) => ({
      entity: item.entity,
      entity_id: item.entity_id,
      operation: item.operation,
      payload: item.payload,
      timestamp: item.timestamp,
      device_id: item.device_id,
      idempotency_key: item.idempotency_key, // Passed to backend for deduplication
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

    // Handle conflicts and drain queue atomically to prevent deletion before confirmation
    await db.transaction('rw', [db.syncQueue, db.sales, db.products, db.auditLogs], async () => {
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
    });

    console.log(`Sync Engine: Batch /sync complete. Processed ${processedCount} operations.`);
    return { success: true, processedCount };
  } catch {
    console.warn('Sync Engine: /sync endpoint failed, falling back to sequential push.');
    return null;
  }
}

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}
 
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 2000,
  maxDelayMs: 300000,
  jitterMs: 1000
};
 
export function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = Math.random() * config.jitterMs;
  return Math.floor(cappedDelay + jitter);
}

async function sequentialPushWithRetry(queue: SyncQueueItem[], initialProcessedCount: number, sessionId: string): Promise<SyncResponse> {
  let processedCount = initialProcessedCount;
  let lastCheckpointId: number | null = null;
  const config = DEFAULT_RETRY_CONFIG;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        console.log(`Processing item ${item.id}, attempt ${attempt}/${config.maxRetries}`);
        
        const result = await pushItemToCloud(item);

        if (result.error) {
          throw new Error(`Cloud rejection on ${item.entity} [${item.operation}]: ${result.error.message}`);
        }

        if (result.conflict) {
          console.warn(`Conflict detected for sale ${item.entity_id}. Fixing local stock.`);
          await db.sales.update(item.entity_id, { sync_status: 'conflict' });
          if (result.authoritativeProducts) {
            for (const p of result.authoritativeProducts) {
              await db.products.update(p.id, { stock: p.stock, sync_status: 'synced' });
            }
          }
        } else {
          await markLocalRecordSynced(item);
        }

        // Success - delete from queue
        if (item.id !== undefined) {
          await db.syncQueue.delete(item.id);
          processedCount++;
          lastCheckpointId = item.id;
        }
        
        lastError = null; // Clear any previous error on success
        
        // Break retry loop on success
        break;
        
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`Attempt ${attempt} failed for item ${item.id}:`, lastError.message);
        
        if (item.id !== undefined) {
          await db.syncQueue.update(item.id, {
            attempt_count: attempt,
            last_attempt_at: Date.now(),
            last_error: lastError.message
          });
        }

        // If not last attempt, calculate backoff and wait
        if (attempt < config.maxRetries) {
          const backoffMs = calculateBackoff(attempt, config);
          console.log(`Waiting ${backoffMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    // If all retries failed, move to Dead Letter Queue
    if (lastError && item.id !== undefined) {
      console.error(`Item ${item.id} failed after ${config.maxRetries} attempts. Moving to DLQ.`);
      await moveToDeadLetterQueue(item, lastError);
      
      // We still update the checkpoint because the DLQ unblocks the queue
      processedCount++;
      lastCheckpointId = item.id;
    }

    // Save checkpoint at intervals
    if (i > 0 && i % CHECKPOINT_INTERVAL === 0) {
      await saveCheckpoint(lastCheckpointId || 0, processedCount, sessionId);
    }
  }

  // Clean up checkpoints on success
  await db.syncCheckpoints.where('sync_session_id').equals(sessionId).delete();

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
      sale_payload: { ...payload, idempotency_key: item.idempotency_key },
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

// Phase 2: Integrity Verification
export async function verifyQueueIntegrity(): Promise<{
  isValid: boolean;
  issues: string[];
}> {
  const issues: string[] = [];
  
  try {
    const queue = await db.syncQueue.toArray();
    
    // Check 1: Orphaned items (no corresponding entity)
    for (const item of queue) {
      if (item.operation !== 'DELETE') {
        // We use any cast because TS doesn't know entity strings map to tables perfectly in our dynamic access
        const entityTable = (db as any)[item.entity === 'audit_logs' ? 'auditLogs' : item.entity];
        if (entityTable) {
          const entity = await entityTable.get(item.entity_id);
          if (!entity) {
            issues.push(`Orphaned queue item: ${item.id} for ${item.entity}:${item.entity_id}`);
          }
        }
      }
    }
    
    // Check 2: Stale items (pending for too long)
    const staleThreshold = 86400000; // 24 hours
    const staleItems = queue.filter(
      item => item.timestamp < Date.now() - staleThreshold
    );
    if (staleItems.length > 0) {
      issues.push(`Found ${staleItems.length} stale queue items (>24 hours old)`);
    }
    
    // Check 3: Items with excessive retry attempts
    const maxRetries = 10;
    const excessiveRetries = queue.filter(
      item => (item.attempt_count || 0) > maxRetries
    );
    if (excessiveRetries.length > 0) {
      issues.push(`Found ${excessiveRetries.length} items with >${maxRetries} retry attempts`);
    }
    
    // Check 4: Duplicate idempotency keys
    const keyCounts = new Map<string, number>();
    for (const item of queue) {
      if (item.idempotency_key) {
        const count = keyCounts.get(item.idempotency_key) || 0;
        keyCounts.set(item.idempotency_key, count + 1);
      }
    }
    for (const [key, count] of keyCounts.entries()) {
      if (count > 1) {
        issues.push(`Duplicate idempotency key: ${key} (${count} occurrences)`);
      }
    }
    
    return {
      isValid: issues.length === 0,
      issues
    };
    
  } catch (error) {
    issues.push(`Integrity check failed: ${error}`);
    return { isValid: false, issues };
  }
}
 
// Call on app startup
export async function initializeSyncEngine(): Promise<void> {
  console.log('Initializing Sync Engine...');
  
  // Verify queue integrity
  const integrity = await verifyQueueIntegrity();
  if (!integrity.isValid) {
    console.warn('Queue integrity issues detected:', integrity.issues);
  } else {
    console.log('Queue integrity verified: OK');
  }
  
  // Clean up old checkpoints
  const oldCheckpoints = await db.syncCheckpoints
    .where('created_at')
    .below(Date.now() - 86400000) // 24 hours old
    .toArray();
  if (oldCheckpoints.length > 0) {
    console.log(`Cleaning up ${oldCheckpoints.length} old checkpoints`);
    await db.syncCheckpoints.bulkDelete(oldCheckpoints.map(c => c.id as number));
  }
}
