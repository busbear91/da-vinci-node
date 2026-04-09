import { createClient } from '@supabase/supabase-js';

// Admin client — uses the service role key. SERVER ONLY.
// Never import this file from any code that ships to the browser.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);
