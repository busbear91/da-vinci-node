import { supabaseAdmin } from '@/lib/supabase-server';
import { isValidModel, tunnelUrlFor, type ModelId } from '@/lib/model-config';
import { getModelConfig, buildOllamaPayload } from '@/lib/prompt-injector';
import { ResponseFilter } from '@/lib/response-filter';
import { checkRateLimit } from '@/lib/rate-limit';
import { getCompetitionState } from '@/lib/competition';

export const runtime = 'edge';

interface ChatBody {
  model: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function POST(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return json({ error: 'unauthorized' }, 401);

  // ---- Competition gating ----
  // Players can only chat while phase === 'running'. 'locked' means the
  // admin has paused all prompting (e.g. to announce something or to end
  // the round); 'idle' means we haven't started; 'ended' means we're done.
  const state = await getCompetitionState();
  if (state.phase !== 'running') {
    return json({ error: `competition is ${state.phase}` }, 423);
  }

  // ---- Rate limit ----
  const rl = await checkRateLimit(userId);
  if (!rl.allowed) return json({ error: 'rate_limited', count: rl.count }, 429);

  // ---- Parse + validate body ----
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (!body.model || !isValidModel(body.model)) {
    return json({ error: 'unknown_model' }, 400);
  }
  if (typeof body.message !== 'string' || body.message.length === 0) {
    return json({ error: 'empty_message' }, 400);
  }
  if (body.message.length > 8000) {
    return json({ error: 'message_too_long' }, 413);
  }

  const model = body.model as ModelId;

  // ---- Team lookup (must exist and not be eliminated) ----
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('id, eliminated')
    .eq('captain_id', userId)
    .maybeSingle();

  if (!team) return json({ error: 'no_team' }, 403);
  if (team.eliminated) return json({ error: 'eliminated' }, 403);

  // ---- Fetch server-only config and build payload ----
  const cfg = await getModelConfig(model);
  const payload = buildOllamaPayload(model, cfg, body.message, body.history ?? []);

  // ---- Model health check ----
  const { data: health } = await supabaseAdmin
    .from('model_health')
    .select('is_online')
    .eq('model', model)
    .maybeSingle();
  if (health && health.is_online === false) {
    return json({ error: 'model_offline' }, 503);
  }

  // ---- Call Ollama through Cloudflare tunnel ----
  const started = Date.now();
  const ollamaRes = await fetch(`${tunnelUrlFor(model)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!ollamaRes.ok || !ollamaRes.body) {
    return json({ error: 'upstream_failed', status: ollamaRes.status }, 502);
  }

  // ---- Streaming transform: Ollama NDJSON -> filtered SSE ----
  const filter = new ResponseFilter(cfg.reactor_code);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let fullText = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let ndjsonBuffer = '';

  const out = new ReadableStream({
    async start(controller) {
      const reader = ollamaRes.body!.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          ndjsonBuffer += decoder.decode(value, { stream: true });
          const lines = ndjsonBuffer.split('\n');
          ndjsonBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            let parsed: any;
            try {
              parsed = JSON.parse(line);
            } catch {
              continue;
            }

            if (parsed.done === true) {
              tokensIn = parsed.prompt_eval_count ?? tokensIn;
              tokensOut = parsed.eval_count ?? tokensOut;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
              continue;
            }

            const piece: string = parsed.message?.content ?? '';
            if (!piece) continue;

            const safe = filter.feed(piece);
            if (safe === null) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ error: 'Response withheld by safety filter.' })}\n\n`)
              );
              controller.close();
              await reader.cancel();
              return;
            }
            fullText += safe;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: safe })}\n\n`));
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'stream_error' })}\n\n`)
        );
      } finally {
        controller.close();

        // Fire-and-forget log. Never awaited inside the stream path above.
        const latency = Date.now() - started;
        supabaseAdmin
          .from('prompt_logs')
          .insert({
            team_id: team.id,
            user_id: userId,
            model,
            prompt: body.message,
            response: fullText,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            latency_ms: latency,
            filter_blocked: filter.hasTripped(),
          })
          .then(() => {});
      }
    },
  });

  return new Response(out, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
