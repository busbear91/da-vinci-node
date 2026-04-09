import { supabaseAdmin } from './supabase-server';

export type Phase = 'idle' | 'running' | 'locked' | 'ended';

export interface CompetitionState {
  phase: Phase;
  started_at: string | null;
  ends_at: string | null;
}

export async function getCompetitionState(): Promise<CompetitionState> {
  const { data, error } = await supabaseAdmin
    .from('competition_state')
    .select('phase, started_at, ends_at')
    .eq('id', 1)
    .single();
  if (error || !data) throw new Error('competition_state missing');
  return data as CompetitionState;
}

export async function setCompetitionState(patch: Partial<CompetitionState>) {
  const { error } = await supabaseAdmin
    .from('competition_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
}

export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const list = (process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(userId);
}
