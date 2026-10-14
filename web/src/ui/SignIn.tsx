import { useState } from 'react';
import type { AuthApi } from '../data/auth';
import { Button } from './primitives';

export function SignIn({ auth }: { auth: AuthApi }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fixed copy: auth server messages are not written for people.
  const run = async (fn: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <h1>Lock In</h1>
      {!sent ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await auth.sendLink(email.trim()); setSent(true); }, "Couldn't send the email."); }}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>Send sign-in email</Button>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(() => auth.verifyCode(email.trim(), code.trim()), "That code didn't work."); }}>
          <p className="muted">Tap the link in the email, or enter its code.</p>
          <label className="field">
            <span>Code</span>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>Sign in</Button>
          <Button variant="quiet" onClick={() => { setSent(false); setCode(''); setError(null); }}>Use another email</Button>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
