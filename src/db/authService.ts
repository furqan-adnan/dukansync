import { supabase } from './supabaseClient';

export interface UserProfile {
  id: string;
  tenant_id: string;
  store_id: string | null;
  role: 'owner' | 'cashier';
}

const PROFILE_CACHE_KEY = 'dukansync_profile_cache';

/**
 * Returns the active session from local storage without requiring a network call.
 * This is crucial for offline-first boots!
 */
export async function getOfflineSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

/**
 * Reads the cached profile from localStorage for immediate offline rendering.
 */
export async function getCachedProfile(): Promise<UserProfile | null> {
  const cached = localStorage.getItem(PROFILE_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as UserProfile;
    } catch (e) {
      console.error("Failed to parse cached profile", e);
    }
  }
  return null;
}

/**
 * Fetches the latest profile from the server and caches it.
 * If the network is down, it gracefully falls back to the cached version.
 */
export async function fetchAndCacheProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error || !data) throw error;
    
    const profile = data as UserProfile;
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    return profile;
  } catch (error) {
    console.warn("Could not fetch profile from network. Using offline cache.", error);
    return await getCachedProfile();
  }
}

export async function logout() {
  localStorage.removeItem(PROFILE_CACHE_KEY);
  await supabase.auth.signOut();
}

/**
 * Abstracts Supabase authentication to keep the UI clean.
 */
export async function login(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
