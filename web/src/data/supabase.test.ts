import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { AlreadyCountedError } from './api';
import { canRate, createSupabaseApi } from './supabase';

interface Call { url: URL; method: string; body: unknown; headers: Record<string, string> }

function harness(responder: (c: Call, init?: RequestInit) => Response | Promise<Response>, syncTimeoutMs?: number) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input), 'http://localhost'),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    calls.push(call);
    return responder(call, init);
  };
  const sb = createClient('https://p.supabase.co', 'anon', {
    global: { fetch: fetchImpl as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const api = createSupabaseApi(sb, { ownerId: async () => 'u1', accessToken: async () => 'tok', fetchImpl: fetchImpl as typeof fetch, syncTimeoutMs });
  return { api, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = () => new Response(null, { status: 204 });

describe('supabase api', () => {
  it('rateSolve PATCHes one unapplied lc_solves row with rating and rated_at', async () => {
    const { api, calls } = harness(() => json([{ id: 5 }]));
    await api.rateSolve(5, 'nailed', new Date('2026-10-14T16:00:00Z'));
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url.pathname).toBe('/rest/v1/lc_solves');
    expect(calls[0].url.searchParams.get('id')).toBe('eq.5');
    expect(calls[0].url.searchParams.get('applied_at')).toBe('is.null');
    expect(calls[0].url.searchParams.get('select')).toBe('id');
    expect(calls[0].body).toEqual({ rating: 'nailed', rated_at: '2026-10-14T16:00:00.000Z' });
  });
  it('rateSolve throws AlreadyCountedError when the worker already applied the solve (I4)', async () => {
    const { api } = harness(() => json([]));
    await expect(api.rateSolve(5, 'nailed', new Date('2026-10-14T16:00:00Z'))).rejects.toBeInstanceOf(AlreadyCountedError);
  });
  it('updateSettings filters by owner', async () => {
    const { api, calls } = harness(empty);
    await api.updateSettings({ daily_lc_count: 7 });
    expect(calls[0].url.searchParams.get('owner')).toBe('eq.u1');
    expect(calls[0].body).toEqual({ daily_lc_count: 7 });
  });
  it('getSettings explains a missing row', async () => {
    const { api } = harness(() => json([]));
    await expect(api.getSettings()).rejects.toThrow('No settings row yet');
  });
  it('queueOutreach inserts the outreach, then a launch request for it', async () => {
    const { api, calls } = harness((c) =>
      c.url.pathname.endsWith('/outreach')
        ? json({ id: 'o1', job_url: 'https://x.com/j', company: null, role: null, resume_path: null, status: 'queued', sent_on: null, follow_up_on: null, created_at: '2026-10-14T16:00:00Z' }, 201)
        : empty());
    const o = await api.queueOutreach({ job_url: 'https://x.com/j' });
    expect(o.id).toBe('o1');
    expect(calls.map((c) => [c.method, c.url.pathname])).toEqual([['POST', '/rest/v1/outreach'], ['POST', '/rest/v1/launch_requests']]);
    expect(calls[0].body).toEqual({ job_url: 'https://x.com/j', company: null, role: null });
    expect(calls[1].body).toEqual({ kind: 'outreach', payload: { outreach_id: 'o1', job_url: 'https://x.com/j' } });
  });
  it('surfaces PostgREST errors', async () => {
    const { api } = harness(() => json({ message: 'permission denied for table ideas' }, 403));
    await expect(api.listIdeas()).rejects.toThrow('permission denied');
  });
  it('syncLeetCode calls the function with the bearer token and maps errors', async () => {
    const ok = harness(() => json({ status: 'ok', added: 2 }));
    expect(await ok.api.syncLeetCode()).toEqual({ status: 'ok', added: 2 });
    expect(ok.calls[0].url.pathname).toBe('/api/sync-leetcode');
    expect(ok.calls[0].method).toBe('POST');
    expect(ok.calls[0].headers.authorization).toBe('Bearer tok');
    const bad = harness(() => json({ error: 'LeetCode HTTP 503' }, 502));
    expect(await bad.api.syncLeetCode()).toEqual({ status: 'error', message: 'LeetCode HTTP 503' });
    const notDeployed = harness(() => new Response('Not Found', { status: 404 }));
    expect(await notDeployed.api.syncLeetCode()).toEqual({ status: 'error', message: 'HTTP 404' });
  });
  it('syncLeetCode returns an error result when fetch rejects', async () => {
    const { api } = harness(() => { throw new Error('offline'); });
    expect(await api.syncLeetCode()).toEqual({ status: 'error', message: 'offline' });
  });
  it('syncLeetCode passes a timeout signal and maps an abort to an error result (I5)', async () => {
    let seen: AbortSignal | null | undefined;
    const { api, calls } = harness((_c, init) => new Promise<Response>((_res, rej) => {
      seen = init?.signal;
      seen?.addEventListener('abort', () => rej(seen?.reason));
    }), 20);
    const r = await api.syncLeetCode();
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(r.status).toBe('error');
    expect(calls).toHaveLength(1);
  });
  it('pages past the 1000-row cap', async () => {
    const mk = (n: number, off: number) => Array.from({ length: n }, (_, i) => ({ id: off + i, sha: `s${off + i}`, project_id: 'p', message: 'm', committed_at: '2026-10-01T00:00:00Z' }));
    const { api, calls } = harness((c) => {
      return json(c.url.searchParams.get('offset') === '1000' ? mk(3, 1000) : mk(1000, 0));
    });
    expect(await api.listCommits('2000-01-01T00:00:00Z')).toHaveLength(1003);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => [c.url.searchParams.get('offset'), c.url.searchParams.get('limit')])).toEqual([['0', '1000'], ['1000', '1000']]);
  });
  it('listIdeas, listOutreach and listContacts page past the cap with a stable id order (M5)', async () => {
    const mk = (n: number, off: number) => Array.from({ length: n }, (_, i) => ({ id: `r${off + i}` }));
    const { api, calls } = harness((c) => json(c.url.searchParams.get('offset') === '1000' ? mk(2, 1000) : mk(1000, 0)));
    expect(await api.listIdeas()).toHaveLength(1002);
    expect(await api.listOutreach()).toHaveLength(1002);
    expect(await api.listContacts()).toHaveLength(1002);
    expect(calls.map((c) => c.url.pathname)).toEqual([
      '/rest/v1/ideas', '/rest/v1/ideas', '/rest/v1/outreach', '/rest/v1/outreach', '/rest/v1/contacts', '/rest/v1/contacts',
    ]);
    for (const c of calls) expect(c.url.searchParams.get('order')).toMatch(/(^|,)id\.asc$/);
  });
  it('canRate is false once the worker applied the solve', () => {
    expect(canRate({ applied_at: null })).toBe(true);
    expect(canRate({ applied_at: '2026-10-13T00:00:00Z' })).toBe(false);
  });
});
