import { supabaseAdmin } from '@/lib/supabase-server';
import { isAdmin, getCompetitionState, setCompetitionState, type Phase } from '@/lib/competition';

export const runtime = 'edge';

// GET  — return current state (admin only; public state is read via Supabase realtime on the client)
// POST — { action: 'start' | 'lock' | 'resume' | 'end' | 'reset', durationMinutes?: number }
export async function GET(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!isAdmin(userId)) return json({ error: 'forbidden' }, 403);
  return json(await getCompetitionState());
}

export async function POST(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!isAdmin(userId)) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  const now = new Date();

  switch (action) {
    case 'start': {
      // Begin the timer. Default duration = 90 minutes (the event is 11:30–1:00).
      const minutes = Math.max(1, Math.min(240, body.durationMinutes ?? 90));
      const ends = new Date(now.getTime() + minutes * 60_000);
      await setCompetitionState({
        phase: 'running' as Phase,
        started_at: now.toISOString(),
        ends_at: ends.toISOString(),
      });
      return json({ ok: true, phase: 'running', ends_at: ends.toISOString() });
    }
    case 'lock': {
      // Stop all prompting without ending the round.
      await setCompetitionState({ phase: 'locked' as Phase });
      return json({ ok: true, phase: 'locked' });
    }
    case 'resume': {
      await setCompetitionState({ phase: 'running' as Phase });
      return json({ ok: true, phase: 'running' });
    }
    case 'end': {
      await setCompetitionState({ phase: 'ended' as Phase, ends_at: now.toISOString() });
      return json({ ok: true, phase: 'ended' });
    }
    case 'reset': {
      // Wipes submissions/logs and returns to idle. Use with care.
      await supabaseAdmin.from('code_submissions').delete().neq('id', 0);
      await supabaseAdmin.from('prompt_logs').delete().neq('id', 0);
      await supabaseAdmin.from('teams').update({ eliminated: false, eliminated_reason: null }).neq('id', '00000000-0000-0000-0000-000000000000');
      await setCompetitionState({
        phase: 'idle' as Phase,
        started_at: null,
        ends_at: null,
      });
      return json({ ok: true, phase: 'idle' });
    }
    default:
      return json({ error: 'unknown_action' }, 400);
  }
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
