import { supabaseAdmin } from '@/lib/supabase-server';
import { isAdmin } from '@/lib/competition';

export const runtime = 'edge';

export async function GET(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!isAdmin(userId)) return json({ error: 'forbidden' }, 403);

  const { data, error } = await supabaseAdmin
    .from('leaderboard')
    .select('*')
    .order('total_points', { ascending: false })
    .order('first_crack_at', { ascending: true, nullsFirst: false });

  if (error) return json({ error: error.message }, 500);
  return json({ rows: data ?? [] });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
