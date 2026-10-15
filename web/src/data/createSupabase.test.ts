import { afterEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn(() => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

describe('createSupabase', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('keeps the session across restarts under the default storage key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    const { createSupabase } = await import('./supabase');
    createSupabase();
    const opts = (createClient.mock.calls[0] as unknown as [string, string, { auth: Record<string, unknown> }])[2];
    expect(opts.auth).toMatchObject({ persistSession: true, autoRefreshToken: true });
    expect(opts.auth).not.toHaveProperty('storageKey');
  });
});
