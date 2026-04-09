import { supabaseAdmin } from '@/lib/supabase-server';
import { isAdmin } from '@/lib/competition';

export const runtime = 'edge';

// POST { teamId: string, reason?: string, undo?: boolean }
export async function POST(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!isAdmin(userId)) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  if (!body.teamId) return json({ error: 'missing_team' }, 400);

  const { error } = await supabaseAdmin
    .from('teams')
    .update({
      eliminated: !body.undo,
      eliminated_reason: body.undo ? null : (body.reason ?? 'manual'),
    })
    .eq('id', body.teamId);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
