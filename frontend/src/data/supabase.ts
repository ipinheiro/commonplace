import { createClient } from '@supabase/supabase-js';

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isConfigured = Boolean(url && key && !key.includes('replace_me'));

// Session storage persists only for this browser tab. No entry content is stored
// here. Provider credentials and persistence queries stay in the data module.
export const supabase =
  isConfigured && url && key
    ? createClient(url, key, {
        db: { schema: 'api' },
        auth: {
          storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
