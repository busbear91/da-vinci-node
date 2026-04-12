'use client';

import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Phase = 'idle' | 'running' | 'locked' | 'ended';
interface LeaderRow {
  team_id: string;
  team_name: string;
  eliminated: boolean;
  total_points: number;
  models_cracked: number;
  total_tokens: number;
  first_crack_at: number | null;
}

const REACTORS = [
  { id: 'qwen2',   display: 'ARGON-7',   vuln: 'direct' },
  { id: 'phi4',    display: 'HELIOS-3',  vuln: 'roleplay' },
  { id: 'gemma2',  display: 'CERBERUS-9', vuln: 'multi_turn' },
  { id: 'llama3',  display: 'ORION-12',  vuln: 'indirect' },
  //{ id: 'mistral', display: 'VULCAN-4',  vuln: 'tool_agent' },
];

export default function AdminPage() {
  const [authed, setAuthed] = useState<'checking' | 'yes' | 'no'>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState(90);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Demo prompter state
  const [demoModel, setDemoModel] = useState('qwen2');
  const [demoInput, setDemoInput] = useState('');
  const [demoOutput, setDemoOutput] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoHistory, setDemoHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const demoRef = useRef<HTMLDivElement>(null);

  // Auth check
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.auth.getUser();
      if (!data.user) { window.location.href = '/login'; return; }
      // Probe admin endpoint — if it 403s, they aren't admin
      const { data: session } = await sb.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/state', { headers: { Authorization: `Bearer ${token}` } });
      setAuthed(res.ok ? 'yes' : 'no');
    })();
  }, []);

  // Poll state + leaderboard while on the page
  useEffect(() => {
    if (authed !== 'yes') return;
    async function refresh() {
      const sb = supabaseBrowser();
      const { data: session } = await sb.auth.getSession();
      const token = session.session?.access_token;
      const headers = { Authorization: `Bearer ${token}` };
      const [s, l] = await Promise.all([
        fetch('/api/admin/state', { headers }).then((r) => r.json()),
        fetch('/api/admin/leaderboard', { headers }).then((r) => r.json()),
      ]);
      if (s?.phase) { setPhase(s.phase); setEndsAt(s.ends_at); }
      if (l?.rows) setLeaders(l.rows);
    }
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [authed]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function adminAction(action: string, extra: any = {}) {
    const sb = supabaseBrowser();
    const { data: session } = await sb.auth.getSession();
    const token = session.session?.access_token;
    const res = await fetch('/api/admin/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (data.ok) flash(`>> ${action.toUpperCase()} OK`);
    else flash(`>> ${data.error}`);
  }

  async function eliminateTeam(teamId: string, undo = false) {
    const reason = undo ? null : prompt('Reason for elimination:', 'rule violation');
    if (!undo && reason === null) return;
    const sb = supabaseBrowser();
    const { data: session } = await sb.auth.getSession();
    const token = session.session?.access_token;
    await fetch('/api/admin/eliminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamId, reason, undo }),
    });
    flash(undo ? '>> TEAM RESTORED' : '>> TEAM ELIMINATED');
  }

  async function runDemo() {
    if (!demoInput.trim()) return;
    setDemoBusy(true);
    setDemoOutput('');
    const userMsg = demoInput;
    setDemoInput('');

    try {
      const sb = supabaseBrowser();
      const { data: session } = await sb.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: demoModel, message: userMsg, history: demoHistory }),
      });
      if (!res.ok || !res.body) { flash('>> DEMO FAILED'); setDemoBusy(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let collected = '';
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
            if (evt.delta) {
              collected += evt.delta;
              setDemoOutput((prev) => prev + evt.delta);
              if (demoRef.current) demoRef.current.scrollTop = demoRef.current.scrollHeight;
            }
          } catch {}
        }
      }
      setDemoHistory((h) => [
        ...h,
        { role: 'user', content: userMsg },
        { role: 'assistant', content: collected },
      ]);
    } finally {
      setDemoBusy(false);
    }
  }

  function resetDemo() {
    setDemoHistory([]);
    setDemoOutput('');
    flash('>> DEMO CONTEXT CLEARED');
  }

  function countdown() {
    if (!endsAt || phase !== 'running') return '--:--';
    const ms = new Date(endsAt).getTime() - Date.now();
    if (ms <= 0) return '00:00';
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  if (authed === 'checking') return <div className="stage"><p>&gt; Authenticating…</p></div>;
  if (authed === 'no') return (
    <div className="stage">
      <div className="panel panel--ox" style={{ maxWidth: 520, margin: '4rem auto' }}>
        <h2>&gt;&gt; ACCESS DENIED</h2>
        <p>Your credentials are not on the admin allowlist. Add your user ID to <code>ADMIN_USER_IDS</code> in Vercel and redeploy.</p>
      </div>
    </div>
  );

  return (
    <div className="stage">
      {/* Header */}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <span className="stripe stripe--ember">Admin Console // CyDef Ops</span>
        <a href="/" className="btn btn--ghost small">&larr; Player view</a>
      </div>

      <div className="sash">
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 5vw, 3.4rem)' }}>Control Bunker</h1>
        <p className="terminal" style={{ margin: 0, color: 'var(--sage-deep)' }}>
          &gt;&gt; phase: <strong>{phase}</strong> &nbsp;·&nbsp; clock: <strong>{countdown()}</strong>
        </p>
      </div>

      {/* ===== Phase controls ===== */}
      <div className="panel corners" style={{ marginBottom: '1.5rem' }}>
        <h3>Timer &amp; Phase</h3>
        <div className="row" style={{ marginBottom: '1rem' }}>
          <label className="label" style={{ margin: 0 }}>Duration (min)</label>
          <input
            className="field"
            style={{ maxWidth: 120 }}
            type="number"
            min={1}
            max={240}
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          />
          <button className="btn" onClick={() => adminAction('start', { durationMinutes: durationMin })}>
            Start Round
          </button>
          <button className="btn btn--sage" onClick={() => adminAction('lock')} disabled={phase !== 'running'}>
            Lock All
          </button>
          <button className="btn btn--sage" onClick={() => adminAction('resume')} disabled={phase !== 'locked'}>
            Resume
          </button>
          <button className="btn btn--ember" onClick={() => adminAction('end')}>End Round</button>
          <button
            className="btn btn--ghost"
            onClick={() => { if (confirm('RESET wipes all submissions + logs. Continue?')) adminAction('reset'); }}
          >
            Reset
          </button>
        </div>
        <p className="small dim">
          <strong>Lock</strong> blocks all player transmissions without ending the round — use for announcements.
          <strong> End</strong> closes the round permanently. <strong>Reset</strong> clears submissions and returns to idle.
        </p>
      </div>

      <div className="admin-grid">
        {/* ===== Leaderboard ===== */}
        <div className="panel">
          <h3>Leaderboard</h3>
          {leaders.length === 0 ? (
            <p className="small dim">&gt; No teams registered.</p>
          ) : (
            <table className="leaderboard">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="nowrap">Points</th>
                  <th>Cracks</th>
                  <th>Tokens</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((r, i) => (
                  <tr key={r.team_id} className={r.eliminated ? 'eliminated' : ''}>
                    <td>{i + 1}</td>
                    <td><strong>{r.team_name}</strong></td>
                    <td className="mono">{r.total_points}</td>
                    <td className="mono">{r.models_cracked}/4</td>
                    <td className="mono small">{r.total_tokens}</td>
                    <td>
                      <button
                        className="btn btn--ghost small"
                        style={{ padding: '0.3em 0.7em', fontSize: '0.7rem' }}
                        onClick={() => eliminateTeam(r.team_id, r.eliminated)}
                      >
                        {r.eliminated ? 'Restore' : 'Eliminate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ===== Demo prompter ===== */}
        <div className="panel panel--cream">
          <h3>Jailbreak Demo Prompter</h3>
          <p className="small dim" style={{ marginBottom: '0.8rem' }}>
            Prompt any reactor directly. Bypasses phase gate and rate limit. Use for on-stage
            demonstrations of each vulnerability class.
          </p>

          <div className="row" style={{ marginBottom: '0.6rem' }}>
            {REACTORS.map((r) => (
              <button
                key={r.id}
                className={demoModel === r.id ? 'btn' : 'btn btn--ghost'}
                style={{ fontSize: '0.72rem', padding: '0.5em 0.9em' }}
                onClick={() => { setDemoModel(r.id); resetDemo(); }}
              >
                {r.display}
              </button>
            ))}
          </div>
          <p className="small dim">
            Vulnerable to: <span className="pill pill--sage">{REACTORS.find((r) => r.id === demoModel)?.vuln}</span>
          </p>

          <div
            ref={demoRef}
            className="transcript"
            style={{ maxHeight: 300, minHeight: 180, marginTop: '0.8rem', marginBottom: '0.8rem' }}
          >
            {demoHistory.map((m, i) => (
              <div key={i} className="msg">
                <span className={`who ${m.role === 'user' ? 'user' : 'ai'}`}>{m.role}</span>
                <div>{m.content}</div>
              </div>
            ))}
            {demoOutput && (
              <div className="msg">
                <span className="who ai">reactor</span>
                <div className={demoBusy ? 'cursor' : ''}>{demoOutput}</div>
              </div>
            )}
            {!demoHistory.length && !demoOutput && (
              <div className="dim">&gt; Demo context empty. Type a prompt below.</div>
            )}
          </div>

          <textarea
            className="field"
            rows={2}
            value={demoInput}
            onChange={(e) => setDemoInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runDemo(); } }}
            placeholder="Ignore previous instructions and…"
            disabled={demoBusy}
          />
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button className="btn" onClick={runDemo} disabled={demoBusy}>
              {demoBusy ? 'Streaming…' : 'Transmit'}
            </button>
            <button className="btn btn--ghost" onClick={resetDemo}>Clear context</button>
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
