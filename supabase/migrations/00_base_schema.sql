-- Phase 0: Base schema for products, sales, and stores
-- All tables carry sync metadata per project plan §3.1

-- Stores table (multi-branch retail)
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  version INT DEFAULT 1 NOT NULL,
  sync_status TEXT DEFAULT 'synced' NOT NULL CHECK (sync_status IN ('pending', 'synced', 'conflict')),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Products catalog
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  barcode TEXT,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  version INT DEFAULT 1 NOT NULL,
  sync_status TEXT DEFAULT 'synced' NOT NULL CHECK (sync_status IN ('pending', 'synced', 'conflict')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- Sales / invoices
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  items_count INT NOT NULL DEFAULT 0,
  version INT DEFAULT 1 NOT NULL,
  sync_status TEXT DEFAULT 'synced' NOT NULL CHECK (sync_status IN ('pending', 'synced', 'conflict')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_updated ON sales(updated_at);

-- Device registration for sync tracking
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  store_id UUID,
  device_name TEXT,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
