-- RLS policies for stores and devices tables

CREATE POLICY "Tenant isolation for stores" ON stores
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Tenant isolation for devices" ON devices
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
