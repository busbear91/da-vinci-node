import { supabaseAdmin } from '@/lib/supabase-server';

export const runtime = 'edge';

export async function GET() {
  const { data } = await supabaseAdmin
    .from('model_health')
    .select('model, is_online, last_seen');
  return new Response(JSON.stringify({ models: data ?? [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
