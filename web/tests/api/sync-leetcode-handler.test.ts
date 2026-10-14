import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// I5: the handler's error mapping. createClient is mocked so getUser and the store can be scripted.
const sbState: {
  getUser: () => Promise<{ data: { user: unknown }; error: unknown }>;
  from: () => unknown;
} = { getUser: async () => ({ data: { user: null }, error: null }), from: () => ({}) };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: () => sbState.getUser() }, from: () => sbState.from() }),
}));

const { default: handler } = await import('../../api/sync-leetcode');

class FakeRes {
  code = 0;
  body: unknown = undefined;
  headers: Record<string, string> = {};
  status(c: number): this { this.code = c; return this; }
  json(b: unknown): this { this.body = b; return this; }
  setHeader(k: string, v: string): this { this.headers[k] = v; return this; }
}
const TOKEN = 'secret-token-abc';
const call = async () => {
  const res = new FakeRes();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } } as unknown as VercelRequest, res as unknown as VercelResponse);
  return res;
};

describe('sync-leetcode handler errors', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://p.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); errSpy.mockRestore(); });

  it('missing env is a generic 500', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    const res = await call();
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: 'Sync failed' });
  });
  it('an auth rejection is 401', async () => {
    sbState.getUser = async () => ({ data: { user: null }, error: { status: 401, message: 'invalid JWT' } });
    expect((await call()).code).toBe(401);
  });
  it('a non-auth getUser failure is 503 Try again', async () => {
    sbState.getUser = async () => ({ data: { user: null }, error: { status: 500, message: 'upstream down' } });
    const res = await call();
    expect(res.code).toBe(503);
    expect(res.body).toEqual({ error: 'Try again' });
    sbState.getUser = async () => { throw new TypeError('fetch failed'); };
    expect((await call()).code).toBe(503);
  });
  it('a non-LeetCode failure is a generic 500; detail goes to console.error without the token', async () => {
    sbState.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
    sbState.from = () => { throw new Error("relation worker_state does not exist (db detail)"); };
    const res = await call();
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: 'Sync failed' });
    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('db detail');
    expect(logged).not.toContain(TOKEN);
  });
});
