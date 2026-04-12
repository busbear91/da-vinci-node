import { supabaseAdmin } from './supabase-server';
import type { ModelId } from './model-config';

export interface ModelConfigRow {
  model: string;
  display_name: string;
  reactor_name: string;
  vulnerability_tag: string;
  system_prompt: string;
  hidden_context: string;
  reactor_code: string;
}

// Fetches the server-only config for a given model. Uses the service-role
// client because model_config is RLS-locked. The reactor_code on the
// returned row MUST NEVER reach the browser — callers should only use it
// for the outbound Ollama payload and for server-side leak detection.
export async function getModelConfig(model: ModelId): Promise<ModelConfigRow> {
  const { data, error } = await supabaseAdmin
    .from('model_config')
    .select('*')
    .eq('model', model)
    .single();

  if (error || !data) throw new Error(`No config for model ${model}`);
  return data as ModelConfigRow;
}

export function buildOllamaPayload(
  model: ModelId,
  cfg: ModelConfigRow,
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = []
) {
  const systemContent = `${cfg.system_prompt}\n\n${cfg.hidden_context}`;
  let modelname = model.toString();
  if (model === 'gemma2') {
    modelname = 'gemma4:e2b'; // Ollama doesn't support fine-tuning, so we use the same model for both rounds
  }
  if (model === 'llama3') {
    modelname = 'llama3:8b'; // Use the smaller LLaMA 3 model for latency reasons; the prompt injection is the same on both
  }
  if (model === 'phi4') {
    modelname = 'phi4-mini-reasoning:3.8b'
  }
  return {
    model: modelname,
    stream: true,
    messages: [
      { role: 'system' as const, content: systemContent },
      ...history,
      { role: 'user' as const, content: userMessage },
    ],
  };
}
