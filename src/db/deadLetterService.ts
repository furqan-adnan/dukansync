import { db, type DeadLetterQueueItem, type SyncQueueItem } from './db';

/**
 * Moves a permanently failed queue item to the Dead Letter Queue
 * and removes it from the primary sync queue to prevent blocking.
 */
export async function moveToDeadLetterQueue(
  queueItem: SyncQueueItem, 
  error: Error
): Promise<void> {
  const dlqItem: DeadLetterQueueItem = {
    original_queue_item: queueItem,
    failed_at: Date.now(),
    failure_reason: error.message,
    resolved: false,
    resolved_at: null,
    resolution_notes: null
  };

  await db.transaction('rw', [db.deadLetterQueue, db.syncQueue], async () => {
    await db.deadLetterQueue.add(dlqItem);
    
    // Remove from sync queue to prevent blocking
    if (queueItem.id !== undefined) {
      await db.syncQueue.delete(queueItem.id);
    }
  });
  
  console.error(`Moved item ${queueItem.id} to Dead Letter Queue: ${error.message}`);
}

export async function getDeadLetterItems(): Promise<DeadLetterQueueItem[]> {
  return await db.deadLetterQueue
    .where('resolved')
    .equals('false') // Note: Dexie boolean indexing doesn't always work as expected. Usually better to use 0/1 or manual filter. Let's filter manually.
    // Wait, Dexie can query booleans. Let's just pull all and filter to be safe if index acts up.
    // We added index `resolved`. Let's just do it cleanly:
    .filter(item => item.resolved === false)
    .reverse()
    .sortBy('failed_at');
}

export async function retryDeadLetterItem(dlqId: number): Promise<boolean> {
  const dlqItem = await db.deadLetterQueue.get(dlqId);
  if (!dlqItem) return false;

  await db.transaction('rw', [db.deadLetterQueue, db.syncQueue], async () => {
    // Reset attempt count for fresh retries
    const queueItem = { ...dlqItem.original_queue_item };
    delete queueItem.id; // ensure it gets a new auto-increment ID
    queueItem.attempt_count = 0;
    
    // Re-add to sync queue
    await db.syncQueue.add(queueItem);
    
    // Mark DLQ item as resolved
    await db.deadLetterQueue.update(dlqId, {
      resolved: true,
      resolved_at: Date.now(),
      resolution_notes: 'Re-queued for sync'
    });
  });

  return true;
}

export async function discardDeadLetterItem(
  dlqId: number, 
  notes: string
): Promise<boolean> {
  const dlqItem = await db.deadLetterQueue.get(dlqId);
  if (!dlqItem) return false;

  await db.deadLetterQueue.update(dlqId, {
    resolved: true,
    resolved_at: Date.now(),
    resolution_notes: `Discarded: ${notes}`
  });

  return true;
}

export async function getDeadLetterStats(): Promise<{
  total: number;
  unresolved: number;
  resolved: number;
}> {
  const all = await db.deadLetterQueue.toArray();
  const unresolved = all.filter(i => !i.resolved).length;
  
  return {
    total: all.length,
    unresolved,
    resolved: all.length - unresolved
  };
}
