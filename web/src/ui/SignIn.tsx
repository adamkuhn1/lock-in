import { useState } from 'react';
import { AuthError, type AuthApi } from '../data/auth';
import { Button } from './primitives';

const EMAIL_KEY = 'lockin-last-email';

function readEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // Storage can be blocked; signing in must not depend on it.
  }
}

export function SignIn({ auth }: { auth: AuthApi }) {
  const [email, setEmail] = useState(readEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fixed copy: auth server messages are not written for people. AuthError messages are already fixed.
  const run = async (fn: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const emailField = (autoComplete: string) => (
    <label className="field">
      <span>Email</span>
      <input type="email" name="email" autoComplete={autoComplete} required value={email} onChange={(e) => setEmail(e.target.value)} />
    </label>
  );

  return (
    <main className="signin">
      <h1>Lock In</h1>
      {mode === 'password' ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => { await auth.signInWithPassword(email.trim(), password); rememberEmail(email.trim()); }, "Couldn't sign in. Try again.");
        }}>
          {emailField('username')}
          <label className="field">
            <span>Password</span>
            <input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>Sign in</Button>
          <Button variant="quiet" onClick={() => { setMode('link'); setError(null); }}>Email me a link instead</Button>
        </form>
      ) : !sent ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await auth.sendLink(email.trim()); rememberEmail(email.trim()); setSent(true); }, "Couldn't send the email."); }}>
          {emailField('email')}
          <Button type="submit" variant="primary" disabled={busy}>Send sign-in email</Button>
          <Button variant="quiet" onClick={() => { setMode('password'); setError(null); }}>Use a password</Button>
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
