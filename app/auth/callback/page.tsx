'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function AuthCallback() {
  const [status, setStatus] = useState('Finalising enlistment…');

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      // Supabase JS auto-parses the URL hash and sets the session
      const { data, error } = await sb.auth.getSession();
      if (error || !data.session) {
        setStatus('Session not found. Try logging in.');
        return;
      }

      const teamName =
        localStorage.getItem('pending_team_name') ||
        data.session.user.user_metadata?.team_name;

      if (teamName) {
        const res = await fetch('/api/register-team', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: JSON.stringify({ teamName }),
        });
        if (!res.ok && res.status !== 409) {
          setStatus(`Team creation failed: ${await res.text()}`);
          return;
        }
        localStorage.removeItem('pending_team_name');
      }
      window.location.href = '/';
    })();
  }, []);

  return (
    <div className="stage">
      <div className="panel corners" style={{ maxWidth: 480, margin: '4rem auto' }}>
        <h2>&gt;&gt; {status}</h2>
      </div>
    </div>
  );
}