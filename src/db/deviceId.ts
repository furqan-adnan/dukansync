const DEVICE_ID_KEY = 'dukansync_device_id';

/**
 * Registers a persistent device ID on first launch.
 * Required for multi-device sync tracking per project plan §3.2.
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    console.info(`[Device] Registered new device: ${id}`);
  }
  return id;
}
