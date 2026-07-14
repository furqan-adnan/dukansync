import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runConcurrencyTest() {
  console.log("=== Phase 2 Validation: Concurrency & Conflict Engine Test ===");
  
  // 1. Fetch a product to test with
  const { data: products, error: pError } = await supabase.from('products').select('*').limit(1);
  if (pError || !products || products.length === 0) {
    console.error("Failed to fetch test product:", pError);
    return;
  }
  const testProduct = products[0];
  console.log(`\nSelected Test Product: ${testProduct.name} (ID: ${testProduct.id})`);

  // 2. Reset its stock to exactly 5
  console.log("Resetting stock to 5 in Supabase...");
  const { error: updateError } = await supabase.from('products').update({ stock: 5 }).eq('id', testProduct.id);
  if (updateError) {
    console.error("Failed to reset stock:", updateError);
    return;
  }

  // 3. Prepare TWO simultaneous sales that both ask for 4 units
  // Total asked = 8, but we only have 5. One should fail.
  console.log("\nSimulating two offline registers syncing at the EXACT same millisecond...");
  
  const createSalePayload = (uuid) => ({
    id: uuid,
    tenant_id: testProduct.tenant_id || "00000000-0000-0000-0000-000000000000",
    store_id: testProduct.store_id || "00000000-0000-0000-0000-000000000000",
    items: [
      { productId: testProduct.id, quantity: 4, priceAtSale: testProduct.price }
    ],
    total_amount: testProduct.price * 4,
    items_count: 4,
    version: 1,
    sync_status: 'pending',
    updated_at: new Date().toISOString()
  });

  const sale1 = createSalePayload(crypto.randomUUID());
  const sale2 = createSalePayload(crypto.randomUUID());

  // 4. Fire them concurrently!
  const start = Date.now();
  const [result1, result2] = await Promise.all([
    supabase.rpc('process_sale_with_conflict_check', { sale_payload: sale1 }),
    supabase.rpc('process_sale_with_conflict_check', { sale_payload: sale2 })
  ]);
  const end = Date.now();

  console.log(`\nRPC calls completed in ${end - start}ms`);
  console.log("--- Request 1 Result ---");
  console.log(JSON.stringify(result1.data, null, 2));
  console.log("--- Request 2 Result ---");
  console.log(JSON.stringify(result2.data, null, 2));

  // 5. Verify Final Stock
  const { data: finalProduct } = await supabase.from('products').select('stock').eq('id', testProduct.id).single();
  console.log(`\nFinal Server Stock: ${finalProduct.stock}`);

  if (finalProduct.stock === 1 && 
     ((result1.data.success === true && result2.data.success === false) || 
      (result1.data.success === false && result2.data.success === true))) {
    console.log("\n✅ SUCCESS: The Postgres lock correctly handled the race condition. One sale passed, one was safely rejected!");
  } else {
    console.log("\n❌ FAILED: The conflict resolution failed to properly lock the row!");
  }
}

runConcurrencyTest();
