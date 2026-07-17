import { db, type AuditLog } from './db';
import { getCachedProfile } from './authService';
import { getDeviceId } from './deviceId';

import { generateIdempotencyKey } from '../utils/idempotency';

/**
 * Intercepts sensitive events and writes an unalterable log to the local Dexie store,
 * while simultaneously queueing it for synchronization to the backend.
 */
export async function logAuditAction(actionType: string, details: Record<string, unknown> = {}) {
  const profile = await getCachedProfile();
  
  if (!profile) {
    console.error("Cannot log audit action: No active user profile found.");
    return;
  }

  const logId = crypto.randomUUID();
  const timestamp = Date.now();
  const deviceId = getDeviceId();

  const newLog: AuditLog = {
    id: logId,
    tenant_id: profile.tenant_id,
    store_id: profile.store_id || '00000000-0000-0000-0000-000000000000',
    user_id: profile.id,
    action_type: actionType,
    details: details,
    timestamp: timestamp,
    version: 1,
    sync_status: 'pending',
    updated_at: timestamp,
    deleted_at: null
  };

  // Perform an atomic database transaction so logs and sync intents are never orphaned
  await db.transaction('rw', [db.auditLogs, db.syncQueue], async () => {
    // 1. Write the log to the local client database
    await db.auditLogs.add(newLog);

    // 2. Append the operation event to the log queue for eventual backup syncing
    await db.syncQueue.add({
      entity: 'audit_logs',
      entity_id: logId,
      operation: 'INSERT',
      payload: newLog,
      timestamp: timestamp,
      device_id: deviceId,
      idempotency_key: generateIdempotencyKey(deviceId, timestamp, 'INSERT', logId),
      attempt_count: 0,
    });
  });

  console.log(`[Audit Engine] Recorded offline-safe action: ${actionType}`);
}
