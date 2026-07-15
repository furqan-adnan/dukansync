import { db } from './db';
import { getCachedProfile } from './authService';
import { supabase } from './supabaseClient';

export interface Store {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
}

const ACTIVE_STORE_KEY = 'dukansync_active_store_id';

/**
 * Returns the currently selected store ID for filtering.
 * Owners can switch stores; cashiers are locked to their assigned store.
 */
export async function getActiveStoreId(): Promise<string | null> {
  const profile = await getCachedProfile();
  if (!profile) return null;

  if (profile.role === 'cashier' && profile.store_id) {
    return profile.store_id;
  }

  return localStorage.getItem(ACTIVE_STORE_KEY) || profile.store_id;
}

export function setActiveStoreId(storeId: string): void {
  localStorage.setItem(ACTIVE_STORE_KEY, storeId);
}

/**
 * Fetches stores for the current tenant from Supabase (cached in memory).
 */
export async function fetchTenantStores(): Promise<Store[]> {
  const profile = await getCachedProfile();
  if (!profile) return [];

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, tenant_id, name, address')
      .eq('tenant_id', profile.tenant_id)
      .is('deleted_at', null);

    if (error) throw error;
    return (data ?? []) as Store[];
  } catch {
    return [];
  }
}

/**
 * Filters local products by active store.
 */
export async function getStoreProducts(): Promise<import('./db').Product[]> {
  const storeId = await getActiveStoreId();
  const all = await db.products.filter((p) => p.deleted_at === null).toArray();

  if (!storeId) return all;
  return all.filter((p) => p.store_id === storeId);
}

/**
 * Filters local sales by active store.
 */
export async function getStoreSales(): Promise<import('./db').Sale[]> {
  const storeId = await getActiveStoreId();
  const all = await db.sales.toArray();

  if (!storeId) return all;
  return all.filter((s) => s.store_id === storeId);
}

/**
 * Creates a new store directly in Supabase (Admin action, online only)
 */
export async function createStore(name: string, address: string | null): Promise<Store> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error("No active profile");

  const newStore = {
    id: crypto.randomUUID(),
    tenant_id: profile.tenant_id,
    name,
    address,
  };

  const { data, error } = await supabase.from('stores').insert(newStore).select().single();
  if (error) throw error;
  
  return data as Store;
}
