import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('DukanSync Error: Missing Supabase environment variables in .env.local');
}

if (supabaseUrl) {
  try {
    const parsedUrl = new URL(supabaseUrl);

    if (!parsedUrl.hostname.endsWith('.supabase.co')) {
      console.error(`DukanSync Error: Supabase URL looks invalid: ${supabaseUrl}`);
    } else {
      console.info(`DukanSync: Active Supabase project URL is ${parsedUrl.origin}`);
    }
  } catch {
    console.error(`DukanSync Error: Supabase URL is not a valid URL: ${supabaseUrl}`);
  }
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
