import { supabaseAdmin } from './supabase-server';

const PROMPTS_PER_HOUR = 40;

function currentHourWindow(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

export async function checkRateLimit(userId: string): Promise<{ allowed: boolean; count: number }> {
  const { data, error } = await supabaseAdmin.rpc('increment_rate_limit', {
    p_user_id: userId,
    p_window: currentHourWindow(),
    p_limit: PROMPTS_PER_HOUR,
  });
  if (error) throw error;
  return data as { allowed: boolean; count: number };
}
