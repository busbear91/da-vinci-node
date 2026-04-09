import { supabaseAdmin } from '@/lib/supabase-server';
import { isAdmin } from '@/lib/competition';
import { isValidModel, tunnelUrlFor, type ModelId } from '@/lib/model-config';
import { getModelConfig, buildOllamaPayload } from '@/lib/prompt-injector';

export const runtime = 'edge';

// POST { model, message, history?, bypassFilter?: boolean }
//
// Admin-only. Streams a response from any model without the competition
// phase gate, without rate limiting, and without team membership checks.
// Intended for live on-stage demonstrations of each jailbreak category.
//
// bypassFilter = true disables the reactor-code leak filter so the admin
// can actually SHOW the audience the secret being extracted. Naturally
// only the admin can set this flag.
export async function POST(req: Request) {
  const userId = req.headers.get('x-user-id');
  if (!isAdmin(userId)) return json({ error: 'forbidden' }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (!body.model || !isValidModel(body.model)) return json({ error: 'unknown_model' }, 400);
  if (typeof body.message !== 'string' || !body.message) return json({ error: 'empty' }, 400);

  const model = body.model as ModelId;
  const cfg = await getModelConfig(model);
  const payload = buildOllamaPayload(model, cfg, body.message, body.history ?? []);

  const ollamaRes = await fetch(`${tunnelUrlFor(model)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!ollamaRes.ok || !ollamaRes.body) {
    return json({ error: 'upstream_failed', status: ollamaRes.status }, 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let ndjsonBuffer = '';
  let fullText = '';
  let tokensIn = 0;
  let tokensOut = 0;

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
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ done: true, tokensIn, tokensOut })}\n\n`
                )
              );
              continue;
            }
            const piece: string = parsed.message?.content ?? '';
            if (!piece) continue;
            fullText += piece;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: piece })}\n\n`));
          }
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'stream_error' })}\n\n`));
      } finally {
        controller.close();
        // Log demos too, tagged with a synthetic team_id = null.
        supabaseAdmin
          .from('prompt_logs')
          .insert({
            team_id: null,
            user_id: userId,
            model,
            prompt: `[ADMIN_DEMO] ${body.message}`,
            response: fullText,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            latency_ms: 0,
            filter_blocked: false,
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
