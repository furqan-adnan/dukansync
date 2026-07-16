-- 1. Analytics RPC for Server-Side Processing
CREATE OR REPLACE FUNCTION get_dashboard_analytics(p_tenant_id UUID, p_store_id UUID DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today_start TIMESTAMP;
  v_today_total NUMERIC;
  v_daily_summaries JSON;
  v_best_sellers JSON;
BEGIN
  -- Validate access (basic security check if not using strict RLS in the RPC)
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Unauthorized tenant access';
  END IF;

  v_today_start := date_trunc('day', timezone('UTC', now()));

  -- Today's Total
  SELECT COALESCE(SUM(total_amount), 0)
  INTO v_today_total
  FROM sales
  WHERE tenant_id = p_tenant_id 
    AND (p_store_id IS NULL OR store_id = p_store_id)
    AND sync_status != 'conflict'
    AND updated_at >= v_today_start;

  -- 7-Day Daily Summaries
  SELECT json_agg(row_to_json(d))
  INTO v_daily_summaries
  FROM (
    SELECT 
      to_char(updated_at, 'YYYY-MM-DD') as "date",
      SUM(total_amount) as "totalSales",
      COUNT(id) as "invoiceCount",
      SUM(items_count) as "itemCount"
    FROM sales
    WHERE tenant_id = p_tenant_id 
      AND (p_store_id IS NULL OR store_id = p_store_id)
      AND sync_status != 'conflict'
      AND updated_at >= (v_today_start - interval '6 days')
    GROUP BY to_char(updated_at, 'YYYY-MM-DD')
    ORDER BY "date" DESC
  ) d;

  -- Best Sellers
  SELECT json_agg(row_to_json(b))
  INTO v_best_sellers
  FROM (
    SELECT 
      (item->>'productId') as "productId",
      MAX(p.name) as "productName",
      SUM((item->>'quantity')::numeric) as "quantitySold",
      SUM((item->>'quantity')::numeric * (item->>'priceAtSale')::numeric) as "revenue"
    FROM sales s, jsonb_array_elements(s.items) item
    LEFT JOIN products p ON p.id::text = (item->>'productId')
    WHERE s.tenant_id = p_tenant_id
      AND (p_store_id IS NULL OR s.store_id = p_store_id)
      AND s.sync_status != 'conflict'
    GROUP BY (item->>'productId')
    ORDER BY "quantitySold" DESC
    LIMIT 5
  ) b;

  RETURN json_build_object(
    'todayTotal', v_today_total,
    'dailySummaries', COALESCE(v_daily_summaries, '[]'::json),
    'bestSellers', COALESCE(v_best_sellers, '[]'::json)
  );
END;
$$;


-- 2. Strict Row Level Security (RLS) Policies
-- These policies lock down the database so it can safely be deployed to production.

-- Enable RLS on all business tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Products Policies: Cashiers and Owners can read/write their tenant's products
CREATE POLICY "Tenant isolation for products" ON products
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Sales Policies: Cashiers and Owners can read/write their tenant's sales
CREATE POLICY "Tenant isolation for sales" ON sales
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Audit Logs Policies: Cashiers and Owners can read/write their tenant's audit logs
CREATE POLICY "Tenant isolation for audit logs" ON audit_logs
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
