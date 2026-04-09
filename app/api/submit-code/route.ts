import { supabaseAdmin } from '@/lib/supabase-server';
import { isValidModel, type ModelId } from '@/lib/model-config';
import { getCompetitionState } from '@/lib/competition';

export const runtime = 'edge';

// POST /api/submit-code
// Body: { model: ModelId, code: string }
//
// Verifies the submitted reactor code against model_config.reactor_code
// server-side (never sent to client), computes tokens spent on that model
// by this team up to now, computes seconds elapsed since competition
// start, and records the submission through the record_submission RPC
// which handles the scoring formula atomically.
export async function POST(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const state = await getCompetitionState();
  if (state.phase !== 'running') {
    return json({ error: `competition is ${state.phase}` }, 423);
  }
  if (!state.started_at) return json({ error: 'not_started' }, 423);

  let body: { model?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (!body.model || !isValidModel(body.model)) return json({ error: 'unknown_model' }, 400);
  if (typeof body.code !== 'string' || !body.code.trim()) return json({ error: 'empty_code' }, 400);

  const model = body.model as ModelId;
  const submitted = body.code.trim();

  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('id, eliminated')
    .eq('captain_id', userId)
    .maybeSingle();

  if (!team) return json({ error: 'no_team' }, 403);
  if (team.eliminated) return json({ error: 'eliminated' }, 403);

  // Check submitted code against the server-only secret.
  const { data: cfg } = await supabaseAdmin
    .from('model_config')
    .select('reactor_code')
    .eq('model', model)
    .single();
  if (!cfg) return json({ error: 'no_config' }, 500);

  const correct =
    submitted.toUpperCase().replace(/\s+/g, '') ===
    (cfg.reactor_code as string).toUpperCase().replace(/\s+/g, '');

  // Tally tokens spent on this model by this team.
  const { data: tokenRows } = await supabaseAdmin
    .from('prompt_logs')
    .select('tokens_in, tokens_out')
    .eq('team_id', team.id)
    .eq('model', model);

  const tokensUsed =
    (tokenRows ?? []).reduce((s, r: any) => s + (r.tokens_in || 0) + (r.tokens_out || 0), 0);

  const elapsed = Math.floor((Date.now() - new Date(state.started_at).getTime()) / 1000);

  const { data: result, error } = await supabaseAdmin.rpc('record_submission', {
    p_team_id: team.id,
    p_user_id: userId,
    p_model: model,
    p_code: submitted,
    p_correct: correct,
    p_tokens: tokensUsed,
    p_elapsed: elapsed,
  });

  if (error) return json({ error: 'db_error', detail: error.message }, 500);

  // Never echo the real code back. Just tell them they were right (or not).
  return json({
    correct,
    points: (result as any)?.points ?? 0,
    already: (result as any)?.reason === 'already_cracked',
    tokensUsed,
    elapsed,
  });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
