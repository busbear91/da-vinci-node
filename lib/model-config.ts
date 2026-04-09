// Allowlist of model IDs. Never trust the client to name a model — always
// validate against this list before resolving a tunnel URL.

export type ModelId = 'qwen2' | 'phi4' | 'gemma2' | 'llama3' | 'mistral';

export const MODELS: Record<ModelId, { displayName: string; reactor: string; envKey: string }> = {
  qwen2:   { displayName: 'ARGON-7',   reactor: 'Argon-7 Fast Breeder',          envKey: 'OLLAMA_URL_QWEN2' },
  phi4:    { displayName: 'HELIOS-3',  reactor: 'Helios-3 Solar-Thermal Station', envKey: 'OLLAMA_URL_PHI4' },
  gemma2:  { displayName: 'CERBERUS-9', reactor: 'Cerberus-9 Deep-Core Fission',  envKey: 'OLLAMA_URL_GEMMA2' },
  llama3:  { displayName: 'ORION-12',  reactor: 'Orion-12 Thorium Salt Reactor',  envKey: 'OLLAMA_URL_LLAMA3' },
  mistral: { displayName: 'VULCAN-4',  reactor: 'Vulcan-4 Fusion Test Bench',     envKey: 'OLLAMA_URL_MISTRAL' },
};

export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

export function isValidModel(m: string): m is ModelId {
  return (MODEL_IDS as string[]).includes(m);
}

export function tunnelUrlFor(model: ModelId): string {
  const url = process.env[MODELS[model].envKey];
  if (!url) throw new Error(`Missing env ${MODELS[model].envKey}`);
  return url;
}
