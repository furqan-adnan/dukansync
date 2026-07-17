-- Atomic Sale Processing with Conflict Detection
-- This function processes a sale by checking product stock atomically.
-- If any product has insufficient stock, it rolls back the stock changes,
-- inserts the sale with sync_status = 'conflict', and returns the conflict state.

create or replace function process_sale_with_conflict_check(sale_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  item jsonb;
  product_id uuid;
  qty int;
  current_stock int;
  is_conflict boolean := false;
  authoritative_products jsonb := '[]'::jsonb;
  i_key text;
begin
  i_key := sale_payload->>'idempotency_key';
  
  IF i_key IS NOT NULL THEN
    -- Check if we already processed this
    IF EXISTS (SELECT 1 FROM idempotency_keys WHERE idempotency_key = i_key) THEN
      RETURN jsonb_build_object('success', true, 'sync_status', 'synced', 'duplicate', true);
    END IF;
    
    -- Insert the key to prevent future duplicates
    INSERT INTO idempotency_keys (idempotency_key) VALUES (i_key) ON CONFLICT DO NOTHING;
  END IF;

  -- 1. Try to decrement stock for all items
  for item in select * from jsonb_array_elements(sale_payload->'items') loop
    product_id := (item->>'productId')::uuid;
    qty := (item->>'quantity')::int;

    -- Lock the product row for update to prevent race conditions
    select stock into current_stock from products where id = product_id for update;

    if current_stock < qty then
      is_conflict := true;
    end if;
  end loop;

  -- 2. Process based on conflict detection
  if is_conflict then
    -- It's a conflict! Insert the sale flagged as conflict, don't change stock
    insert into sales (
      id, tenant_id, store_id, items, total_amount, items_count, version, sync_status, updated_at
    ) values (
      (sale_payload->>'id')::uuid,
      (sale_payload->>'tenant_id')::uuid,
      (sale_payload->>'store_id')::uuid,
      sale_payload->'items',
      (sale_payload->>'total_amount')::numeric,
      (sale_payload->>'items_count')::int,
      (sale_payload->>'version')::int,
      'conflict',
      (sale_payload->>'updated_at')::timestamp
    )
    on conflict (id) do update set
      sync_status = 'conflict',
      updated_at = excluded.updated_at;

    -- Return the authoritative state of the products involved so the client can fix its local DB
    select jsonb_agg(jsonb_build_object('id', id, 'stock', stock))
    into authoritative_products
    from products
    where id in (select (jsonb_array_elements(sale_payload->'items')->>'productId')::uuid);

    return jsonb_build_object(
      'success', false,
      'sync_status', 'conflict',
      'authoritative_products', coalesce(authoritative_products, '[]'::jsonb)
    );

  else
    -- No conflict! Decrement stock and insert sale
    for item in select * from jsonb_array_elements(sale_payload->'items') loop
      product_id := (item->>'productId')::uuid;
      qty := (item->>'quantity')::int;
      
      update products set stock = stock - qty where id = product_id;
    end loop;

    insert into sales (
      id, tenant_id, store_id, items, total_amount, items_count, version, sync_status, updated_at
    ) values (
      (sale_payload->>'id')::uuid,
      (sale_payload->>'tenant_id')::uuid,
      (sale_payload->>'store_id')::uuid,
      sale_payload->'items',
      (sale_payload->>'total_amount')::numeric,
      (sale_payload->>'items_count')::int,
      (sale_payload->>'version')::int,
      'synced',
      (sale_payload->>'updated_at')::timestamp
    )
    on conflict (id) do update set
      sync_status = 'synced',
      updated_at = excluded.updated_at;

    return jsonb_build_object(
      'success', true,
      'sync_status', 'synced'
    );
  end if;
end;
$$;
