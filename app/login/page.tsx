'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Submit Login / New-Team Form
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const sb = supabaseBrowser();

    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (!teamName.trim()) throw new Error('Team call-sign required');
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) throw new Error('No session returned from sign-up');

        const res = await fetch('/api/register-team', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: JSON.stringify({ teamName: teamName.trim() }),
        });
        if (!res.ok && res.status !== 409) {
          throw new Error(`Team registration failed: ${await res.text()}`);
        }
      }
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage">
      <div style={{ maxWidth: 520, margin: '4rem auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <span className="stripe">CyDef // Access Terminal</span>
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 6vw, 3.6rem)' }}>
          {mode === 'login' ? 'Operator Login' : 'New Op Sign-Up'}
        </h1>
        <p className="small dim" style={{ marginBottom: '2rem' }}>
          {mode === 'login'
            ? 'Authenticate to continue to the reactor control terminal.'
            : 'Register your strike team. Captains only — teammates watch over your shoulder.'}
        </p>

        <form onSubmit={submit} className="panel corners">
          {mode === 'register' && (
            <div style={{ marginBottom: '1rem' }}>
              <label className="label">Team Call-Sign</label>
              <input
                className="field"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. OVERRIDE SQUAD"
                maxLength={40}
              />
            </div>
          )}
          <div style={{ marginBottom: '1rem' }}>
            <label className="label">Email</label>
            <input
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="label">Passphrase</label>
            <input
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--oxblood)', fontFamily: 'var(--f-mono)', marginBottom: '1rem' }}>
              &gt; {error}
            </p>
          )}

          <div className="row">
            <button className="btn" disabled={busy}>
              {busy ? 'Transmitting…' : mode === 'login' ? 'Jack In' : 'Enlist'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'New team?' : 'Have an account?'}
            </button>
          </div>
        </form>

        <p className="small dim center" style={{ marginTop: '2rem' }}>
          Colossus &rsquo;26 · CyDef · Plaksha University · 12 April 2026
        </p>
      </div>
    </div>
  );
}
