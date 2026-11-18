import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Server-side client with the service_role key (bypasses RLS).
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
