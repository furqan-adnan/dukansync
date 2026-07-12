import { db } from './db';
import { supabase } from './supabaseClient';

export async function processSyncQueue() {
  const queue = await db.syncQueue.orderBy('id').toArray();
  
  if (queue.length === 0) {
    console.log('Sync Engine: Queue is completely clean. No pending events.');
    return { success: true, processedCount: 0 };
  }

  console.log(`Sync Engine: Commencing batch upload for ${queue.length} pending events...`);
  let processedCount = 0;

  // 1. FIXED: Naming the loop variable 'item' completely untangles the naming conflict
  for (const item of queue) {
    try {
      // 2. FIXED: Grabbing the exact property keys stored in your IndexedDB ('entity', 'operation')
      const { entity, operation, payload } = item;

      // 3. FIXED: The conditional routing now evaluates correctly (e.g., 'products' === 'products')
      if (entity === 'products') {
        if (operation === 'INSERT' || operation === 'UPDATE') {
          const { error } = await supabase
            .from('products')
            .upsert({
              id: payload.id,
              name: payload.name,
              barcode: payload.barcode || null,
              price: payload.price,
              stock: payload.stock,
              version: payload.version || 1,
              sync_status: 'synced',
              updated_at: new Date().toISOString()
            });

          if (error) throw error;
        }
      } 
      
      else if (entity === 'sales') {
        if (operation === 'INSERT') {
          const { error } = await supabase
            .from('sales')
            .upsert({
              id: payload.id,
              total_amount: payload.total,
              items_count: payload.items ? payload.items.reduce((acc: number, i: any) => acc + i.quantity, 0) : 0,
              version: 1,
              sync_status: 'synced',
              updated_at: new Date().toISOString()
            });

          if (error) throw error;
        }
      }

      // 4. Clean up local log entry only after successful cloud confirmation
      if (item.id) {
        await db.syncQueue.delete(item.id);
        processedCount++;
      }

    } catch (err) {
      console.error(`Sync Engine stalled at operation ID ${item.id}:`, err);
      break; 
    }
  }

  return { success: true, processedCount };
}