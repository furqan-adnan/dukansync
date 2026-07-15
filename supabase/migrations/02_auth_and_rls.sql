-- Phase 3: Auth, RBAC, and Audit Logs Migration

-- 1. Create Profiles Table (Linked to Supabase Auth)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  tenant_id UUID NOT NULL,
  store_id UUID, -- If null, they are an owner of all stores under the tenant
  role TEXT CHECK (role IN ('owner', 'cashier')) NOT NULL DEFAULT 'cashier',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. Create Audit Logs Table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  store_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  action_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp BIGINT NOT NULL,
  
  -- Distributed Sync Metadata Fields
  version INT DEFAULT 1 NOT NULL,
  sync_status TEXT DEFAULT 'synced' NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies based on tenant_id isolation

-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can read/write products within their tenant
CREATE POLICY "Tenant isolation for products" ON products
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Users can read/write sales within their tenant
CREATE POLICY "Tenant isolation for sales" ON sales
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Users can read/write audit_logs within their tenant
CREATE POLICY "Tenant isolation for audit_logs" ON audit_logs
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Note: In a true production environment, you might restrict cashiers from DELETING or UPDATING sales,
-- but for this offline-first sync engine MVP where updates are needed for conflict resolution, ALL is acceptable.
