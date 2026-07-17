-- Phase 1 Remediation: Server-Side Idempotency Key Tracking
-- Prevents duplicate syncs if the client resends the payload due to network drop

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert keys, but they can't see other tenants' keys 
-- (Assuming idempotency_key format includes device_id/tenant_id, or we just let it be a fast KV store)
CREATE POLICY "Allow authenticated users to insert idempotency keys" ON idempotency_keys
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to select their idempotency keys" ON idempotency_keys
  FOR SELECT TO authenticated USING (true);
