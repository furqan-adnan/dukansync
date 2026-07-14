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

// 3. Core Local Sync Queue Structure mandated by Section 3.2
export interface SyncQueueItem {
  id?: number;                                    // Auto-incrementing index for local sequence playback 
  entity: 'products' | 'sales';                   // Target database table [cite: 68]
  entity_id: string;                              // Client UUID of the modified row [cite: 68]
  operation: 'INSERT' | 'UPDATE' | 'DELETE';      // Type of transactional state mutation [cite: 68]
  payload: unknown;                               // Transformed delta data packet [cite: 68]
  timestamp: number;                              // Global sequence order epoch [cite: 68]
  device_id: string;                              // Source machine tracking signature [cite: 68]
}

class DukanSyncDatabase extends Dexie {
  products!: Table<Product>;
  sales!: Table<Sale>;
  syncQueue!: Table<SyncQueueItem>;

  constructor() {
    super('DukanSyncDB');
    
    // Setting up indexing for fast offline lookups
    // Only index fields required for WHERE filtering and table sorting
    this.version(1).stores({
      products: 'id, store_id, barcode, sync_status, updated_at',
      sales: 'id, store_id, sync_status, updated_at',
      syncQueue: '++id, entity, operation, timestamp'
    });
  }
}

export const db = new DukanSyncDatabase();
