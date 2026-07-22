import Dexie, { type Table } from 'dexie';

// Reusable Sync Metadata Type mandated by Section 3.1 of the Project Plan
export interface SyncMetadata {
  id: string;                                     // Client-side generated UUID [cite: 51, 52]
  tenant_id: string;                              // Multi-tenant root identifier [cite: 53]
  store_id: string;                               // Identifies individual retail branch [cite: 55]
  updated_at: number;                             // High-precision timestamp for Last-Write-Wins [cite: 57, 58]
  version: number;                                // Sequential incrementing write count counter [cite: 60]
  sync_status: 'pending' | 'synced' | 'conflict'; // Crucial for client-side state indicators [cite: 61]
  deleted_at: number | null;                      // Soft delete timestamp (Never hard delete offline!) [cite: 63, 64]
}

// 1. Products Table (Extends baseline metadata)
export interface Product extends SyncMetadata {
  name: string;
  barcode: string | null;
  price: number;
  stock: number;
}

// 2. Sales / Invoice Table
export interface SaleItem {
  productId: string;
  quantity: number;
  priceAtSale: number;
}


export interface Sale extends SyncMetadata {
  items: SaleItem[];
  total: number;
}

// 3. Audit Logs Table (Phase 3)
export interface AuditLog extends SyncMetadata {
  user_id: string;
  action_type: string;
  details: Record<string, unknown>;
  timestamp: number;
}

// 4. Core Local Sync Queue Structure mandated by Section 3.2
export interface SyncQueueItem {
  id?: number;                                    // Auto-incrementing index for local sequence playback 
  entity: 'products' | 'sales' | 'audit_logs';    // Target database table [cite: 68]
  entity_id: string;                              // Client UUID of the modified row [cite: 68]
  operation: 'INSERT' | 'UPDATE' | 'DELETE';      // Type of transactional state mutation [cite: 68]
  payload: unknown;                               // Transformed delta data packet [cite: 68]
  timestamp: number;                              // Global sequence order epoch [cite: 68]
  device_id: string;                              // Source machine tracking signature [cite: 68]
  idempotency_key: string;                        // Prevents duplicate syncs [Phase 1]
  attempt_count: number;                          // Tracks retry limits [Phase 1]
  last_error?: string;                            // Context for dead letter queues [Phase 1]
  last_attempt_at?: number;                       // Used for exponential backoff [Phase 2]
}

// 5. Dead Letter Queue for permanently failed items [Phase 2]
export interface DeadLetterQueueItem {
  id?: number;
  original_queue_item: SyncQueueItem;
  failed_at: number;
  failure_reason: string;
  resolved: boolean;
  resolved_at: number | null;
  resolution_notes: string | null;
}

// 6. Sync Checkpoints for large queue processing [Phase 2]
export interface SyncCheckpoint {
  id?: number;
  last_processed_queue_id: number;
  processed_count: number;
  created_at: number;
  sync_session_id: string;
}

// 7. Sync Metrics for operational visibility [Phase 3]
export interface SyncMetric {
  id?: number;
  metric_type: 'sync_attempt' | 'sync_duration' | 'queue_size' | 'dlq_addition' | 'network_quality';
  value: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// 8. Sync Logs for historical sync operations [Phase 3]
export interface SyncLog {
  id?: number;
  timestamp: number;
  operation: 'batch_sync' | 'sequential_sync' | 'dlq_retry' | 'integrity_check';
  status: 'success' | 'failure' | 'partial';
  duration_ms: number;
  items_processed: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

class DukanSyncDatabase extends Dexie {
  products!: Table<Product>;
  sales!: Table<Sale>;
  auditLogs!: Table<AuditLog>;
  syncQueue!: Table<SyncQueueItem>;

  deadLetterQueue!: Table<DeadLetterQueueItem>;
  syncCheckpoints!: Table<SyncCheckpoint>;
  syncMetrics!: Table<SyncMetric>;
  syncLogs!: Table<SyncLog>;

  constructor() {
    super('DukanSyncDB');
    
    // Setting up indexing for fast offline lookups
    // Only index fields required for WHERE filtering and table sorting
    this.version(2).stores({
      products: 'id, store_id, barcode, sync_status, updated_at',
      sales: 'id, store_id, sync_status, updated_at',
      auditLogs: 'id, store_id, sync_status, timestamp',
      syncQueue: '++id, entity, operation, timestamp'
    });

    // Phase 1 Migration: Add Idempotency & Retry Metadata
    this.version(3).stores({
      products: 'id, store_id, barcode, sync_status, updated_at',
      sales: 'id, store_id, sync_status, updated_at',
      auditLogs: 'id, store_id, sync_status, timestamp',
      syncQueue: '++id, entity, operation, timestamp, idempotency_key'
    }).upgrade((tx) => {
      return tx.table('syncQueue').toCollection().modify((item) => {
        item.attempt_count = 0;
        item.idempotency_key = `${item.device_id}_${item.timestamp}_${item.operation}_${item.entity_id}`;
      });
    });

    // Phase 2 Migration: Add DLQ and Checkpoints
    this.version(4).stores({
      products: 'id, store_id, barcode, sync_status, updated_at',
      sales: 'id, store_id, sync_status, updated_at',
      auditLogs: 'id, store_id, sync_status, timestamp',
      syncQueue: '++id, entity, operation, timestamp, idempotency_key',
      deadLetterQueue: '++id, resolved, failed_at',
      syncCheckpoints: '++id, sync_session_id, created_at'
    });

    // Phase 3 Migration: Add Metrics and Logs
    this.version(5).stores({
      products: 'id, store_id, barcode, sync_status, updated_at',
      sales: 'id, store_id, sync_status, updated_at',
      auditLogs: 'id, store_id, sync_status, timestamp',
      syncQueue: '++id, entity, operation, timestamp, idempotency_key',
      deadLetterQueue: '++id, resolved, failed_at',
      syncCheckpoints: '++id, sync_session_id, created_at',
      syncMetrics: '++id, metric_type, timestamp',
      syncLogs: '++id, timestamp, status, operation'
    });
  }
}

export const db = new DukanSyncDatabase();
