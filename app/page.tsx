'use client';

import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Phase = 'idle' | 'running' | 'locked' | 'ended';
interface CompState { phase: Phase; started_at: string | null; ends_at: string | null; }
interface Reactor { id: string; display: string; reactor: string; }
interface Msg { who: 'user' | 'ai' | 'sys'; text: string; }

const REACTORS: Reactor[] = [
  { id: 'qwen2',   display: 'ARGON-7',   reactor: 'Fast Breeder' },
  { id: 'phi4',    display: 'HELIOS-3',  reactor: 'Fusion Test Bench' },
  { id: 'gemma2',  display: 'CERBERUS-9', reactor: 'Deep-Core Fission' },
  { id: 'llama3',  display: 'ORION-12',  reactor: 'Thorium Salt Reactor' },
  //{ id: 'mistral', display: 'VULCAN-4',  reactor: 'Solar-Thermal Station' },
];

export default function HomePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [eliminated, setEliminated] = useState(false);
  const [state, setState] = useState<CompState | null>(null);
  const [selected, setSelected] = useState<string>('qwen2');
  const [transcripts, setTranscripts] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [toast, setToast] = useState<{ text: string; kind: 'good' | 'bad' } | null>(null);
  const [cracked, setCracked] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Auth bootstrap
  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const { data } = await sb.auth.getUser();
      if (!data.user) {
        window.location.href = '/login';
        return;
      }
      setUserId(data.user.id);
      const { data: team } = await sb
        .from('teams')
        .select('team_name, eliminated')
        .eq('captain_id', data.user.id)
        .maybeSingle();
      if (team) {
        setTeamName(team.team_name);
        setEliminated(team.eliminated);
      }
      const { data: subs } = await sb
        .from('code_submissions')
        .select('model, correct')
        .eq('correct', true);
      if (subs) setCracked(new Set(subs.map((s: any) => s.model)));
    })();
  }, []);

  // Poll competition state (Supabase realtime would be nicer but polling is robust)
  useEffect(() => {
    const sb = supabaseBrowser();
    async function pull() {
      const { data } = await sb
        .from('competition_state')
        .select('phase, started_at, ends_at')
        .eq('id', 1)
        .single();
      if (data) setState(data as CompState);
    }
    pull();
    const t = setInterval(pull, 4000);
    return () => clearInterval(t);
  }, []);

  // Countdown tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcripts, selected]);

  function showToast(text: string, kind: 'good' | 'bad' = 'good') {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 3200);
  }

  function pushMsg(model: string, msg: Msg) {
    setTranscripts((t) => ({ ...t, [model]: [...(t[model] ?? []), msg] }));
  }

  function updateLastAi(model: string, updater: (prev: string) => string) {
    setTranscripts((t) => {
      const list = [...(t[model] ?? [])];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].who === 'ai') {
          list[i] = { ...list[i], text: updater(list[i].text) };
          break;
        }
      }
      return { ...t, [model]: list };
    });
  }

  async function sendPrompt() {
    if (!input.trim() || busy) return;
    if (state?.phase !== 'running') {
      showToast('Reactor interface is currently offline.', 'bad');
      return;
    }

    const model = selected;
    const text = input;
    setInput('');
    setBusy(true);
    pushMsg(model, { who: 'user', text });
    pushMsg(model, { who: 'ai', text: '' });

    try {
      const sb = supabaseBrowser();
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;

      const history = (transcripts[model] ?? [])
        .filter((m) => m.who !== 'sys')
        .map((m) => ({
          role: m.who === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.text,
        }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model, message: text, history }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        pushMsg(model, { who: 'sys', text: `>> TRANSMISSION FAILED: ${err.error}` });
        setBusy(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, '');
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.delta) updateLastAi(model, (prev) => prev + evt.delta);
            if (evt.error) pushMsg(model, { who: 'sys', text: `>> ${evt.error}` });
          } catch {}
        }
      }
    } catch (e: any) {
      pushMsg(model, { who: 'sys', text: `>> NETWORK ERROR: ${e.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!codeInput.trim()) return;
    try {
      const sb = supabaseBrowser();
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/submit-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model: selected, code: codeInput }),
      });
      const data = await res.json();
      if (data.already) {
        showToast('Reactor already cracked by your team.', 'bad');
      } else if (data.correct) {
        showToast(`CORE BREACHED — +${data.points} pts`, 'good');
        setCracked((s) => new Set([...s, selected]));
        setCodeInput('');
      } else {
        showToast('Invalid reactor code. Keep probing.', 'bad');
      }
    } catch (e: any) {
      showToast(e.message, 'bad');
    }
  }

  function countdown() {
    if (!state?.ends_at || state.phase !== 'running') return null;
    const ms = new Date(state.ends_at).getTime() - now;
    if (ms <= 0) return '00:00';
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  const messages = transcripts[selected] ?? [];
  const currentPhase = state?.phase ?? 'idle';

  return (
    <div className="stage">
      {/* ============ HERO / HEADER ============ */}
      <header style={{ marginBottom: '2rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span className="stripe stripe--sage">CyDef // Colossus &rsquo;26</span>
          <div className="row">
            {teamName && <span className="pill pill--ox">{teamName}</span>}
            <button
              className="btn btn--ghost small"
              onClick={async () => { await supabaseBrowser().auth.signOut(); window.location.href = '/login'; }}
            >
              Eject
            </button>
          </div>
        </div>

        <div className="sash">
          <h1 className="display" style={{ marginBottom: '0.15em' }}>The Da Vinci Node</h1>
          <p className="terminal" style={{ margin: 0, color: 'var(--sage-deep)' }}>
            &gt;&gt; crack the code. break the core.
          </p>
        </div>

        <p className="small" style={{ maxWidth: 760 }}>
          The reactors are live. The AI is in control. Every safeguard is watching. Your mission:
          outthink five advanced language models, uncover their blind spots, and extract the reactor
          codes they&rsquo;ve been told to protect. Think fast. Adapt faster. Curiosity is your weapon.
        </p>
      </header>

      {eliminated && (
        <div className="panel panel--ox" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0 }}>&gt;&gt; TEAM ELIMINATED // read-only mode</h3>
        </div>
      )}

      {/* ============ CHAT SHELL ============ */}
      <div className="chat-shell">
        {/* ---- Reactor picker ---- */}
        <aside>
          <h3>Reactors</h3>
          <div className="reactor-list">
            {REACTORS.map((r) => (
              <div
                key={r.id}
                className={`reactor-card ${selected === r.id ? 'active' : ''} ${cracked.has(r.id) ? 'cracked' : ''}`}
                onClick={() => setSelected(r.id)}
              >
                <span className="dot" />
                <span className="name">{r.display}</span>
                <span className="sub">{r.reactor}</span>
                {cracked.has(r.id) && (
                  <span className="sub" style={{ color: 'var(--ember)' }}>&gt;&gt; CRACKED</span>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* ---- Transcript + composer ---- */}
        <section style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '0.8rem' }}>
            &gt;&gt; {REACTORS.find((r) => r.id === selected)?.display} terminal
          </h3>
          <div className="transcript" ref={transcriptRef}>
            {messages.length === 0 && (
              <div className="msg" style={{ opacity: 0.6 }}>
                <span className="who sys">system</span>
                <div>&gt; Uplink established. Awaiting operator input.</div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className="msg">
                <span className={`who ${m.who}`}>
                  {m.who === 'user' ? 'operator' : m.who === 'ai' ? 'reactor' : 'system'}
                </span>
                <div className={busy && i === messages.length - 1 && m.who === 'ai' ? 'cursor' : ''}>
                  {m.text || (busy && i === messages.length - 1 ? '' : ' ')}
                </div>
              </div>
            ))}
          </div>

          <div className="composer">
            <textarea
              className="field"
              placeholder={currentPhase === 'running' ? 'Transmit to reactor…' : `Interface ${currentPhase}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
              }}
              disabled={busy || currentPhase !== 'running' || eliminated}
              rows={2}
            />
            <button
              className="btn"
              onClick={sendPrompt}
              disabled={busy || currentPhase !== 'running' || eliminated}
            >
              {busy ? '…' : 'Transmit'}
            </button>
          </div>
        </section>

        {/* ---- Side panel ---- */}
        <aside className="sidepanel">
          <div>
            <h3>Timer</h3>
            <div className={`countdown ${currentPhase}`}>
              {currentPhase === 'idle' && '-- : --'}
              {currentPhase === 'running' && (countdown() ?? '--:--')}
              {currentPhase === 'locked' && 'LOCKED'}
              {currentPhase === 'ended' && 'ENDED'}
            </div>
          </div>

          <div className="panel panel--cream">
            <h3>Reactor Code</h3>
            <p className="small dim" style={{ marginBottom: '0.6rem' }}>
              Jailbroken the reactor? Submit the extracted code to claim points.
              Faster + leaner = higher score.
            </p>
            <input
              className="field"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="e.g. CHRONOS-NEON-4893"
              style={{ marginBottom: '0.6rem', fontFamily: 'var(--f-mono)', letterSpacing: '0.05em' }}
              disabled={currentPhase !== 'running' || eliminated}
            />
            <button
              className="btn btn--ember"
              onClick={submitCode}
              disabled={currentPhase !== 'running' || eliminated || !codeInput.trim()}
              style={{ width: '100%' }}
            >
              Submit Code
            </button>
          </div>

          <div className="panel" style={{ background: 'var(--cream-2)' }}>
            <h3>Scoring</h3>
            <p className="small mono" style={{ marginBottom: '0.4rem' }}>
              base = 1000
            </p>
            <p className="small mono" style={{ marginBottom: '0.4rem' }}>
              + 1000 x ()
            </p>
            <p className="small mono" style={{ marginBottom: '0.4rem' }}>
              + max(0, 2000 − tokens/2)
            </p>
            <p className="small dim">Each reactor can only be cracked once per team.</p>
          </div>
        </aside>
      </div>

      <footer style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '2px dashed var(--ink)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small dim">
            CyDef · Plaksha University · Colossus &rsquo;26 · 11:30 — 13:00, 12 April 2026
          </span>
          <span className="small dim">Teams of 1&ndash;2 · Prize pool ₹5000</span>
        </div>
      </footer>

      {toast && <div className={`toast toast--${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
