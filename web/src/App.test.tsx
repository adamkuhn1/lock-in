import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthApi } from './data/auth';
import { demoAuth } from './data/auth';
import { createDemoApi } from './data/demo';
import App from './App';

describe('AuthGate', () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
  const mk = (over: Partial<AuthApi>): AuthApi => ({ ...demoAuth, ...over });

  it('a network failure in hasSession keeps the app up (cached session)', async () => {
    render(<App api={createDemoApi()} auth={mk({ hasSession: () => Promise.reject(new Error("Couldn't reach the server. Try again.")) })} />);
    expect(await screen.findByRole('heading', { level: 1, name: /^Day \d+$/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
  it('a real "no session" answer shows sign-in', async () => {
    render(<App api={createDemoApi()} auth={mk({ hasSession: async () => false })} />);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
  it('a SIGNED_OUT event still shows sign-in', async () => {
    let fire: (ok: boolean) => void = () => undefined;
    render(<App api={createDemoApi()} auth={mk({ onChange: (cb) => { fire = cb; return () => undefined; } })} />);
    await screen.findByRole('heading', { level: 1, name: /^Day \d+$/ });
    fire(false);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
  it('INITIAL_SESSION/null after a rejected hasSession does not sign the user out; SIGNED_OUT still does', async () => {
    let fire: (e: string, ok: boolean) => void = () => undefined;
    // Mirrors supabaseAuth.onChange, which drops INITIAL_SESSION with no session.
    const onChange: AuthApi['onChange'] = (cb) => { fire = (e, ok) => { if (e === 'INITIAL_SESSION' && !ok) return; cb(ok); }; return () => undefined; };
    render(<App api={createDemoApi()} auth={mk({ hasSession: () => Promise.reject(new Error('offline')), onChange })} />);
    await screen.findByRole('heading', { level: 1, name: /^Day \d+$/ });
    fire('INITIAL_SESSION', false);
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /^Day \d+$/ })).toBeInTheDocument();
    fire('SIGNED_OUT', false);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
});
