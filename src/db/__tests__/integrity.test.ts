import { describe, it, expect, beforeEach } from 'vitest';
import { db, type SyncQueueItem } from '../db';
import { verifyQueueIntegrity } from '../syncEngine';

describe('Queue Integrity', () => {
  beforeEach(async () => {
    await db.syncQueue.clear();
    await db.products.clear();
  });

  it('detects orphaned queue items', async () => {
    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'deleted-prod',
      operation: 'UPDATE',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev',
      idempotency_key: 'key1',
      attempt_count: 0
    } as SyncQueueItem);

    const integrity = await verifyQueueIntegrity();
    expect(integrity.isValid).toBe(false);
    expect(integrity.issues.some(i => i.includes('Orphaned queue item'))).toBe(true);
  });

  it('detects stale queue items', async () => {
    // Add product so it's not orphaned
    await db.products.add({
      id: 'stale-prod',
      tenant_id: 'tenant',
      store_id: 'store',
      name: 'Test',
      barcode: null,
      price: 100,
      stock: 10,
      version: 1,
      sync_status: 'pending',
      updated_at: Date.now() - 90000000,
      deleted_at: null
    });

    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'stale-prod',
      operation: 'INSERT',
      payload: {},
      timestamp: Date.now() - 90000000, // 25 hours ago
      device_id: 'dev',
      idempotency_key: 'key2',
      attempt_count: 0
    } as SyncQueueItem);

    const integrity = await verifyQueueIntegrity();
    expect(integrity.isValid).toBe(false);
    expect(integrity.issues.some(i => i.includes('stale queue items'))).toBe(true);
  });

  it('detects duplicate idempotency keys', async () => {
    await db.products.add({
      id: 'prod1',
      tenant_id: 'tenant',
      store_id: 'store',
      name: 'Test',
      barcode: null,
      price: 100,
      stock: 10,
      version: 1,
      sync_status: 'pending',
      updated_at: Date.now(),
      deleted_at: null
    });
    await db.products.add({
      id: 'prod2',
      tenant_id: 'tenant',
      store_id: 'store',
      name: 'Test',
      barcode: null,
      price: 100,
      stock: 10,
      version: 1,
      sync_status: 'pending',
      updated_at: Date.now(),
      deleted_at: null
    });

    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'prod1',
      operation: 'INSERT',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev',
      idempotency_key: 'DUPLICATE_KEY',
      attempt_count: 0
    } as SyncQueueItem);

    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'prod2',
      operation: 'INSERT',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev',
      idempotency_key: 'DUPLICATE_KEY',
      attempt_count: 0
    } as SyncQueueItem);

    const integrity = await verifyQueueIntegrity();
    expect(integrity.isValid).toBe(false);
    expect(integrity.issues.some(i => i.includes('Duplicate idempotency key'))).toBe(true);
  });

  it('reports valid queue as healthy', async () => {
    await db.products.add({
      id: 'valid-prod',
      tenant_id: 'tenant',
      store_id: 'store',
      name: 'Test',
      barcode: null,
      price: 100,
      stock: 10,
      version: 1,
      sync_status: 'pending',
      updated_at: Date.now(),
      deleted_at: null
    });

    await db.syncQueue.add({
      entity: 'products',
      entity_id: 'valid-prod',
      operation: 'INSERT',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev',
      idempotency_key: 'UNIQUE_KEY',
      attempt_count: 0
    } as SyncQueueItem);

    const integrity = await verifyQueueIntegrity();
    expect(integrity.isValid).toBe(true);
    expect(integrity.issues.length).toBe(0);
  });
});
