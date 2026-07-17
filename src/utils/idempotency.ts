/**
 * Generates a globally unique idempotency key for sync operations.
 * Ensures that if a network request drops after the server processes it,
 * the automatic retry won't create duplicate records.
 */
export function generateIdempotencyKey(deviceId: string, timestamp: number, operation: string, entityId: string): string {
  return `${deviceId}_${timestamp}_${operation}_${entityId}`;
}
