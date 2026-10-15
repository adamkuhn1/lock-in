import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { AuthError, demoAuth, mapAuthError, supabaseAuth } from './auth';

const WRONG = 'Wrong email or password.';
const NET = "Couldn't reach the server. Try again.";
const WEAK = 'Use at least 10 characters.';
const REAUTH = 'For security, sign in with the email link once on this device, then set your password.';

describe('mapAuthError', () => {
  it.each([
    [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, WRONG],
    [{ message: 'Invalid login credentials' }, WRONG],
    [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, NET],
    [{ message: 'TypeError: network request failed' }, NET],
    [{ message: 'Load failed' }, NET],
    [{ message: 'NetworkError when attempting to fetch resource.' }, NET],
    [{ code: 'weak_password', message: 'Password should be at least 6 characters' }, WEAK],
    [{ message: 'Password should be at least 6 characters.' }, WEAK],
    [{ code: 'reauthentication_needed', message: 'Password update requires reauthentication' }, REAUTH],
    [{ code: 'reauthentication_not_valid', message: 'x' }, REAUTH],
  ])('%j -> %s', (err, copy) => {
    const e = mapAuthError(err);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.message).toBe(copy);
  });
  it('does not call a loose "fetch" or "network" mention a network failure', () => {
    expect(mapAuthError({ message: 'Could not fetch user' }).message).toBe("Couldn't sign in. Try again.");
    expect(mapAuthError({ message: 'Invalid network configuration' }).message).toBe("Couldn't sign in. Try again.");
  });
  it('never leaks an unknown backend message', () => {
    expect(mapAuthError({ message: 'PGRST301 boom' }).message).toBe("Couldn't sign in. Try again.");
    expect(mapAuthError(new Error('secret')).message).not.toMatch(/secret/);
  });
});

function fakeSb(over: Record<string, unknown> = {}) {
  const auth = {
    signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({ data: {}, error: null })),
    getSession: vi.fn(async () => ({ data: { session: { user: {} } }, error: null })),
    ...over,
  };
  return { sb: { auth } as unknown as SupabaseClient, auth };
}

describe('supabaseAuth passwords', () => {
  it('signs in with email and password', async () => {
    const { sb, auth } = fakeSb();
    await supabaseAuth(sb).signInWithPassword('a@b.co', 'hunter2hunter2');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'hunter2hunter2' });
  });
  it('maps a wrong password to fixed copy', async () => {
    const { sb } = fakeSb({ signInWithPassword: async () => ({ data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }) });
    await expect(supabaseAuth(sb).signInWithPassword('a@b.co', 'x')).rejects.toThrow(WRONG);
  });
  it('maps a thrown network failure', async () => {
    const { sb } = fakeSb({ signInWithPassword: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(supabaseAuth(sb).signInWithPassword('a@b.co', 'x')).rejects.toThrow(NET);
  });
  it('sets the password with updateUser', async () => {
    const { sb, auth } = fakeSb();
    await supabaseAuth(sb).setPassword('longenough1');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'longenough1' });
  });
  it('maps a reauthentication error on set', async () => {
    const { sb } = fakeSb({ updateUser: async () => ({ data: {}, error: { code: 'reauthentication_needed', message: 'Password update requires reauthentication' } }) });
    await expect(supabaseAuth(sb).setPassword('longenough1')).rejects.toThrow(REAUTH);
  });
});

describe('supabaseAuth.hasSession', () => {
  it('is true with a session and false without one', async () => {
    expect(await supabaseAuth(fakeSb().sb).hasSession()).toBe(true);
    const none = fakeSb({ getSession: async () => ({ data: { session: null }, error: null }) });
    expect(await supabaseAuth(none.sb).hasSession()).toBe(false);
  });
  it('rejects (rather than says signed out) when the refresh failed on the network', async () => {
    const { sb } = fakeSb({ getSession: async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } }) });
    await expect(supabaseAuth(sb).hasSession()).rejects.toThrow();
  });
});

describe('supabaseAuth.hasSession errors', () => {
  it('rejects when getSession throws', async () => {
    const { sb } = fakeSb({ getSession: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(supabaseAuth(sb).hasSession()).rejects.toThrow();
  });
  it('detects a retryable fetch error by name, whatever its message', async () => {
    const { sb } = fakeSb({ getSession: async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'odd text' } }) });
    await expect(supabaseAuth(sb).hasSession()).rejects.toThrow();
  });
  it('a non-network error with no session is signed out', async () => {
    const { sb } = fakeSb({ getSession: async () => ({ data: { session: null }, error: { name: 'AuthApiError', message: 'Invalid Refresh Token' } }) });
    expect(await supabaseAuth(sb).hasSession()).toBe(false);
  });
});

describe('supabaseAuth.onChange', () => {
  function listen(over: Record<string, unknown> = {}) {
    let emit: (e: string, s: unknown) => void = () => undefined;
    const unsubscribe = vi.fn();
    const { sb } = fakeSb({ onAuthStateChange: (cb: typeof emit) => { emit = cb; return { data: { subscription: { unsubscribe } } }; }, ...over });
    const cb = vi.fn();
    const off = supabaseAuth(sb).onChange(cb);
    return { emit: (e: string, s: unknown) => emit(e, s), cb, off, unsubscribe };
  }
  it('ignores INITIAL_SESSION with no session (hasSession owns that answer)', () => {
    const { emit, cb } = listen();
    emit('INITIAL_SESSION', null);
    expect(cb).not.toHaveBeenCalled();
  });
  it('passes INITIAL_SESSION with a session, sign-ins and sign-outs through', () => {
    const { emit, cb } = listen();
    emit('INITIAL_SESSION', { user: {} });
    emit('SIGNED_OUT', null);
    emit('SIGNED_IN', { user: {} });
    expect(cb.mock.calls).toEqual([[true], [false], [true]]);
  });
  it('unsubscribes', () => {
    const { off, unsubscribe } = listen();
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe('demoAuth', () => {
  it('accepts both password calls', async () => {
    await expect(demoAuth.signInWithPassword('a@b.co', 'x')).resolves.toBeUndefined();
    await expect(demoAuth.setPassword('longenough1')).resolves.toBeUndefined();
  });
});
