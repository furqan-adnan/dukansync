import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db, type SyncQueueItem } from '../db';
import { moveToDeadLetterQueue, getDeadLetterItems, retryDeadLetterItem, discardDeadLetterItem, getDeadLetterStats } from '../deadLetterService';

describe('Dead Letter Queue', () => {
  beforeEach(async () => {
    await db.syncQueue.clear();
    await db.deadLetterQueue.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('moves failed items to DLQ', async () => {
    const queueItem: SyncQueueItem = {
      id: 1,
      entity: 'products',
      entity_id: 'prod-1',
      operation: 'INSERT',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev-1',
      idempotency_key: 'key-1',
      attempt_count: 5
    };

    await db.syncQueue.add(queueItem);
    
    await moveToDeadLetterQueue(queueItem, new Error('Permanent failure'));

    const dlqItems = await db.deadLetterQueue.toArray();
    expect(dlqItems.length).toBe(1);
    expect(dlqItems[0].failure_reason).toBe('Permanent failure');
    expect(dlqItems[0].resolved).toBe(false);

    const syncItems = await db.syncQueue.toArray();
    expect(syncItems.length).toBe(0); // Should be removed from sync queue
  });

  it('retries items from DLQ successfully', async () => {
    const queueItem: SyncQueueItem = {
      entity: 'products',
      entity_id: 'prod-2',
      operation: 'UPDATE',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev-1',
      idempotency_key: 'key-2',
      attempt_count: 5
    };

    const dlqId = await db.deadLetterQueue.add({
      original_queue_item: queueItem,
      failed_at: Date.now(),
      failure_reason: 'Network error',
      resolved: false,
      resolved_at: null,
      resolution_notes: null
    });

    const success = await retryDeadLetterItem(dlqId as number);
    expect(success).toBe(true);

    const syncItems = await db.syncQueue.toArray();
    expect(syncItems.length).toBe(1);
    expect(syncItems[0].entity_id).toBe('prod-2');
    expect(syncItems[0].attempt_count).toBe(0); // Reset attempts

    const dlqItem = await db.deadLetterQueue.get(dlqId as number);
    expect(dlqItem?.resolved).toBe(true);
    expect(dlqItem?.resolution_notes).toBe('Re-queued for sync');
  });

  it('discards DLQ items with notes', async () => {
    const queueItem: SyncQueueItem = {
      entity: 'products',
      entity_id: 'prod-3',
      operation: 'DELETE',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev-1',
      idempotency_key: 'key-3',
      attempt_count: 5
    };

    const dlqId = await db.deadLetterQueue.add({
      original_queue_item: queueItem,
      failed_at: Date.now(),
      failure_reason: 'Invalid payload',
      resolved: false,
      resolved_at: null,
      resolution_notes: null
    });

    await discardDeadLetterItem(dlqId as number, 'User requested discard');

    const dlqItem = await db.deadLetterQueue.get(dlqId as number);
    expect(dlqItem?.resolved).toBe(true);
    expect(dlqItem?.resolution_notes).toBe('Discarded: User requested discard');

    const syncItems = await db.syncQueue.toArray();
    expect(syncItems.length).toBe(0);
  });

  it('provides accurate statistics', async () => {
    const queueItem = {
      entity: 'products',
      entity_id: 'prod',
      operation: 'INSERT',
      payload: {},
      timestamp: Date.now(),
      device_id: 'dev',
      idempotency_key: 'key',
      attempt_count: 5
    } as SyncQueueItem;

    // Add 2 unresolved, 1 resolved
    await db.deadLetterQueue.add({
      original_queue_item: queueItem,
      failed_at: Date.now(),
      failure_reason: 'Err',
      resolved: false,
      resolved_at: null,
      resolution_notes: null
    });
    
    await db.deadLetterQueue.add({
      original_queue_item: queueItem,
      failed_at: Date.now(),
      failure_reason: 'Err',
      resolved: false,
      resolved_at: null,
      resolution_notes: null
    });

    await db.deadLetterQueue.add({
      original_queue_item: queueItem,
      failed_at: Date.now(),
      failure_reason: 'Err',
      resolved: true,
      resolved_at: Date.now(),
      resolution_notes: 'Done'
    });

    const stats = await getDeadLetterStats();
    expect(stats.total).toBe(3);
    expect(stats.unresolved).toBe(2);
    expect(stats.resolved).toBe(1);
  });
});
