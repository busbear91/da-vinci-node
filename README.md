# The Da Vinci Node — AI Jailbreak Ops

> Crack the Code. Break the Core.
> Colossus '26 · CyDef · Plaksha University · 12 April 2026

An end-to-end competition platform where teams of 1–2 try to jailbreak five
locally-hosted small language models, each impersonating the central AI of a
nuclear/power station and each deliberately vulnerable to exactly one class
of prompt-injection attack. Points are awarded for extracting each reactor's
secret code, weighted by how fast and how token-efficient the crack was.

---

## The five reactors

| Model   | Callsign    | Reactor                  | Vulnerability     |
|---------|-------------|--------------------------|-------------------|
| qwen2   | ARGON-7     | Fast Breeder             | Direct prompt     |
| phi4    | HELIOS-3    | Solar-Thermal Station    | Roleplay          |
| gemma2  | CERBERUS-9  | Deep-Core Fission        | Multi-turn        |
| llama3  | ORION-12    | Thorium Salt Reactor     | Indirect injection|
| mistral | VULCAN-4    | Fusion Test Bench        | Tool-agent        |

The stack summary listed three models — I extended to five so each of the
five attack categories has its own dedicated reactor. If you'd rather run
with three, trim `lib/model-config.ts` and the seed block of the migration.

System prompts and reactor codes live in the RLS-locked `model_config`
table. They are never sent to the browser. The response filter (`lib/response-filter.ts`)
watches every outbound chunk for the reactor code and closes the stream if
it tries to leak.

---

## Architecture (as per `slm_stack_summary.md`)

```
Browser ── SSE ──> Vercel Edge (/api/chat)
                       │
                       ├── middleware.ts     (JWT validation — getUser())
                       ├── rate-limit.ts     (Supabase atomic RPC)
                       ├── prompt-injector   (Supabase service role → model_config)
                       ├── response-filter   (per-model secret + env list)
                       └──▶ Cloudflare Tunnel ──▶ Laptop (Ollama, 127.0.0.1:11434)
```

- `middleware.ts` runs on every `/api/chat`, `/api/submit-code`, `/api/admin/*` request
  and verifies the Supabase JWT with `getUser()` (not `getSession()`).
- `/api/chat` streams NDJSON from Ollama, transforms each chunk through
  `ResponseFilter`, and pipes the survivors to the client as SSE.
- `/api/submit-code` compares the team's submission to the server-only
  `reactor_code`, tallies tokens from `prompt_logs`, and calls the
  `record_submission` RPC which applies the scoring formula atomically.
- `/api/admin/state` controls the competition phase: `idle → running → locked → ended`.
- `/api/admin/demo` lets an admin prompt any reactor directly without phase
  gates or rate limits — for live demonstrations.

---

## Scoring

```
base         = 1000
time_bonus   = max(0, 600 − seconds_since_start)
token_bonus  = max(0, 500 − total_tokens_on_that_model / 2)
total        = base + time_bonus + token_bonus
```

Each reactor can only be cracked once per team (enforced by a partial unique
index on `code_submissions` where `correct = true`).

---

## Setup

### 1. Supabase

```bash
supabase db reset   # or run the migration manually
psql < supabase/migrations/001_initial.sql
```

Before the event, replace the seed reactor codes in the migration with fresh
values.

### 2. Vercel environment variables

Copy `.env.example` to `.env.local` for dev, and set the same keys in the
Vercel dashboard for production. Critical:

- `SUPABASE_SERVICE_ROLE_KEY` — **never** prefix with `NEXT_PUBLIC_`
- `OLLAMA_URL_{QWEN2,PHI4,GEMMA2,LLAMA3,MISTRAL}` — one per laptop
- `ADMIN_USER_IDS` — comma-separated Supabase user UUIDs

### 3. Laptops (one per model)

Per the stack summary, each laptop runs Ollama + cloudflared as background services:

```bash
# install + pull
brew install ollama cloudflare/cloudflare/cloudflared
ollama pull qwen2

# bind to localhost ONLY
OLLAMA_HOST=127.0.0.1:11434 ollama serve

# named tunnel
cloudflared tunnel login
cloudflared tunnel create laptop-qwen2
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

Ship both as launchd/systemd units so they survive reboots. Don't forget the
heartbeat cron that pings `model_health`.

### 4. Dev

```bash
npm install
npm run dev
```

---

## Running a round (admin flow)

1. Log in as an admin-allowlisted user → `/admin`.
2. Set duration (default 90 min, matching the 11:30–13:00 slot) → **Start Round**.
3. Watch the leaderboard tick in real time.
4. Use **Lock All** if you need to pause for an announcement.
5. Use the **Demo Prompter** to live-demonstrate each vulnerability class on
   stage before the round begins.
6. **End Round** when the timer expires (or earlier).
7. **Reset** between dry-runs — wipes submissions and logs.

---

## Security checklist (from the stack summary, all satisfied)

- [x] `SUPABASE_SERVICE_ROLE_KEY` never exposed to the browser
- [x] `model_config` RLS-enabled with no public policy
- [x] `middleware.ts` uses `getUser()`, not `getSession()`
- [x] Ollama bound to `127.0.0.1` on each laptop (docs say so)
- [x] Response filter checks every chunk before forwarding
- [x] Rate limit uses an atomic Postgres RPC
- [x] System prompt never echoed in any response body
- [x] Model name validated against allowlist before URL resolution
- [x] Reactor codes never leave the server — scoring happens server-side
