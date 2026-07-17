import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface SyncOperation {
  entity: 'products' | 'sales' | 'audit_logs';
  entity_id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown>;
  timestamp: number;
  device_id: string;
  idempotency_key?: string;
}

interface SyncRequest {
  operations: SyncOperation[];
  device_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body: SyncRequest = await req.json();
    const { operations, device_id } = body;

    if (!operations?.length) {
      return new Response(JSON.stringify({ processed: 0, conflicts: [], authoritative: {} }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Register device heartbeat
    const { data: profile } = await userClient
      .from('profiles')
      .select('tenant_id, store_id')
      .eq('id', user.id)
      .single();

    if (profile) {
      await supabase.from('devices').upsert({
        id: device_id,
        tenant_id: profile.tenant_id,
        store_id: profile.store_id,
        last_seen_at: new Date().toISOString(),
      });
    }

    const conflicts: string[] = [];
    let processed = 0;

    // Process operations in timestamp order (idempotent via client UUID)
    const sorted = [...operations].sort((a, b) => a.timestamp - b.timestamp);

    // Fetch existing idempotency keys to prevent duplicates
    const incomingKeys = sorted.map(op => op.idempotency_key).filter(Boolean) as string[];
    const { data: existingKeys } = await userClient
      .from('idempotency_keys')
      .select('idempotency_key')
      .in('idempotency_key', incomingKeys);
      
    const existingKeySet = new Set(existingKeys?.map(k => k.idempotency_key) ?? []);
    const newKeysToInsert = new Set<string>();

    for (const op of sorted) {
      if (op.idempotency_key && existingKeySet.has(op.idempotency_key)) {
        processed++; // Already processed successfully in a previous drop
        continue;
      }

      if (op.operation === 'DELETE') {
        const { error } = await userClient.from(op.entity).delete().eq('id', op.entity_id);
        if (!error) processed++;
        continue;
      }

      if (op.entity === 'products') {
        const payload = op.payload;
        const { error } = await userClient.from('products').upsert({
          id: payload.id,
          tenant_id: payload.tenant_id,
          store_id: payload.store_id,
          name: payload.name,
          barcode: payload.barcode ?? null,
          price: payload.price,
          stock: payload.stock,
          version: payload.version,
          sync_status: 'synced',
          updated_at: new Date(payload.updated_at as number).toISOString(),
        });
        if (!error) processed++;
        continue;
      }

      if (op.entity === 'audit_logs') {
        const payload = op.payload;
        const { error } = await userClient.from('audit_logs').insert({
          id: payload.id,
          tenant_id: payload.tenant_id,
          store_id: payload.store_id,
          user_id: payload.user_id,
          action_type: payload.action_type,
          details: payload.details,
          timestamp: payload.timestamp,
          version: payload.version,
          sync_status: 'synced',
          updated_at: new Date(payload.updated_at as number).toISOString(),
        });
        if (!error) processed++;
        continue;
      }

      if (op.entity === 'sales' && op.operation === 'INSERT') {
        const payload = op.payload;
        const { data, error } = await userClient.rpc('process_sale_with_conflict_check', {
          sale_payload: {
            id: payload.id,
            tenant_id: payload.tenant_id,
            store_id: payload.store_id,
            items: payload.items,
            total_amount: payload.total,
            items_count: (payload.items as Array<{ quantity: number }>).reduce(
              (c, i) => c + i.quantity, 0
            ),
            version: payload.version,
            sync_status: 'pending',
            updated_at: new Date(payload.updated_at as number).toISOString(),
          },
        });

        if (error) continue;

        const result = data as { sync_status?: string };
        if (result?.sync_status === 'conflict') {
          conflicts.push(op.entity_id);
        } else {
          processed++;
        }
      }
      
      // Mark as processed
      if (op.idempotency_key) {
        newKeysToInsert.add(op.idempotency_key);
      }
    }

    // Persist new idempotency keys in bulk
    if (newKeysToInsert.size > 0) {
      await userClient.from('idempotency_keys').insert(
        Array.from(newKeysToInsert).map(k => ({ idempotency_key: k }))
      );
    }

    // Return authoritative state for client merge
    const { data: products } = await userClient.from('products').select('*');
    const { data: sales } = await userClient.from('sales').select('*');

    return new Response(
      JSON.stringify({
        processed,
        conflicts,
        authoritative: { products: products ?? [], sales: sales ?? [] },
      }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
