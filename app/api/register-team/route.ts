// register-team
import { supabaseAdmin } from '@/lib/supabase-server';
export const runtime = 'edge';

export async function POST(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return new Response('unauthorized', { status: 401 });
  const { teamName } = await req.json();
  if (!teamName?.trim()) return new Response('bad_name', { status: 400 });
  const { error } = await supabaseAdmin
    .from('teams')
    .insert({ captain_id: userId, team_name: teamName.trim() });
  if (error) return new Response(error.message, { status: 500 });
  return new Response('ok');
}