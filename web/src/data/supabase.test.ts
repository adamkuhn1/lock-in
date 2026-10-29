import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { AlreadyCountedError } from './api';
import { SHEET_TIMEOUT_MS, canRate, createSupabaseApi } from './supabase';

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
  it('queueTailor inserts the outreach, then a tailor_resume launch request for it', async () => {
    const { api, calls } = harness((c) =>
      c.url.pathname.endsWith('/outreach')
        ? json({ id: 'o9', job_url: 'https://x.com/j', company: 'X', role: 'SWE', resume_path: null, status: 'queued', sent_on: null, follow_up_on: null, created_at: '2026-10-14T16:00:00Z' }, 201)
        : empty());
    const o = await api.queueTailor({ job_url: 'https://x.com/j', company: 'X', role: 'SWE' });
    expect(o.id).toBe('o9');
    expect(calls.map((c) => [c.method, c.url.pathname])).toEqual([['POST', '/rest/v1/outreach'], ['POST', '/rest/v1/launch_requests']]);
    expect(calls[0].body).toEqual({ job_url: 'https://x.com/j', company: 'X', role: 'SWE' });
    expect(calls[1].body).toEqual({ kind: 'tailor_resume', payload: { outreach_id: 'o9', job_url: 'https://x.com/j' } });
  });
  it('queueTailor with fill asks the Mac to fill in the application too', async () => {
    const { api, calls } = harness((c) =>
      c.url.pathname.endsWith('/outreach')
        ? json({ id: 'o9', job_url: 'https://x.com/j', company: 'X', role: 'SWE', resume_path: null, status: 'queued', sent_on: null, follow_up_on: null, created_at: '2026-10-14T16:00:00Z' }, 201)
        : empty());
    await api.queueTailor({ job_url: 'https://x.com/j', company: 'X', role: 'SWE', fill: true });
    expect(calls[0].body).toEqual({ job_url: 'https://x.com/j', company: 'X', role: 'SWE' });
    expect(calls[1].body).toEqual({ kind: 'tailor_resume', payload: { outreach_id: 'o9', job_url: 'https://x.com/j', fill_application: true } });
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
  it('listApplications selects sheet_row, and still works before migration 0005 adds it', async () => {
    const row = { id: 1, company: 'Ramp', role: null, track: null, term: null, location: null, status: 'Applied', stage: 'applied', priority: null, applied_on: null };
    const withCol = harness(() => json([{ ...row, sheet_row: 7 }]));
    expect(await withCol.api.listApplications()).toEqual([{ ...row, sheet_row: 7 }]);
    expect(withCol.calls[0].url.searchParams.get('select')).toContain('sheet_row');
    const before = harness((c) => (c.url.searchParams.get('select')?.includes('sheet_row')
      ? json({ code: '42703', message: 'column applications.sheet_row does not exist' }, 400)
      : json([row])));
    expect(await before.api.listApplications()).toEqual([row]);
    expect(before.calls).toHaveLength(3); // with tier, then without, then without sheet_row
    const noTier = harness((c) => (c.url.searchParams.get('select')?.includes('tier')
      ? json({ code: '42703', message: 'column applications.tier does not exist' }, 400)
      : json([{ ...row, sheet_row: 7 }])));
    expect(await noTier.api.listApplications()).toEqual([{ ...row, sheet_row: 7 }]);
    expect(noTier.calls).toHaveLength(2);
    const other = harness(() => json({ message: 'permission denied for table applications' }, 403));
    await expect(other.api.listApplications()).rejects.toThrow('permission denied');
  });
  it('listOutreach selects followups, and still works (as 0) before migration 0006 adds it', async () => {
    const row = { id: 'o1', job_url: 'https://x.com/1', company: 'Ramp', role: null, resume_path: null, status: 'sent', sent_on: null, follow_up_on: null, created_at: '2026-10-14T12:00:00Z' };
    const withCol = harness(() => json([{ ...row, followups: 2 }]));
    expect(await withCol.api.listOutreach()).toEqual([{ ...row, followups: 2 }]);
    expect(withCol.calls[0].url.searchParams.get('select')).toContain('followups');
    const before = harness((c) => (c.url.searchParams.get('select')?.includes('followups')
      ? json({ code: '42703', message: 'column outreach.followups does not exist' }, 400)
      : json([row])));
    expect(await before.api.listOutreach()).toEqual([{ ...row, followups: 0 }]);
    const other = harness(() => json({ message: 'permission denied for table outreach' }, 403));
    await expect(other.api.listOutreach()).rejects.toThrow('permission denied');
  });
  it('the /api/sheet client timeout is 40 s', () => {
    expect(SHEET_TIMEOUT_MS).toBe(40_000);
  });
  it('sheetStatuses GETs /api/sheet?op=statuses with the bearer token', async () => {
    const { api, calls } = harness(() => json({ statuses: ['Applied', 'Rejected after OA'] }));
    expect(await api.sheetStatuses()).toEqual(['Applied', 'Rejected after OA']);
    expect(calls[0].url.pathname).toBe('/api/sheet');
    expect(calls[0].url.searchParams.get('op')).toBe('statuses');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers.authorization).toBe('Bearer tok');
  });
  it('setApplicationStatus POSTs set_status and throws the server message on error', async () => {
    const ok = harness(() => json({ ok: true, synced: false }));
    await ok.api.setApplicationStatus({ id: 11, company: 'Ramp', role: null, sheet_row: 7 }, 'OA invited');
    expect(ok.calls[0].method).toBe('POST');
    expect(ok.calls[0].body).toEqual({ op: 'set_status', application_id: 11, company: 'Ramp', role: null, sheet_row: 7, status: 'OA invited' });
    await ok.api.setApplicationStatus({ id: 12, company: 'Visa', role: 'SWE' }, 'OA invited');
    expect(ok.calls[1].body).toEqual({ op: 'set_status', application_id: 12, company: 'Visa', role: 'SWE', status: 'OA invited' });
    expect(ok.calls[0].headers.authorization).toBe('Bearer tok');
    const gone = harness(() => json({ error: "Couldn't find that row in your Sheet; it may have moved. Refresh and try again." }, 409));
    await expect(gone.api.setApplicationStatus({ id: 11, company: 'Ramp', role: null }, 'x')).rejects.toThrow("Couldn't find that row");
  });
  it('markApplied returns {duplicate} on 409 duplicate and {} on success', async () => {
    const dup = harness(() => json({ duplicate: true, error: 'Already in your Sheet.' }, 409));
    expect(await dup.api.markApplied({ posting_id: 'p1' })).toEqual({ duplicate: true });
    expect(dup.calls[0].body).toEqual({ op: 'applied', posting_id: 'p1' });
    const ok = harness(() => json({ ok: true }));
    expect(await ok.api.markApplied({ outreach_id: 'o1', force: true })).toEqual({});
    expect(ok.calls[0].body).toEqual({ op: 'applied', outreach_id: 'o1', force: true });
  });
  it('sheet calls map network failures, timeouts and non-JSON errors to the fixed Google message', async () => {
    const off = harness(() => { throw new Error('offline'); });
    await expect(off.api.sheetStatuses()).rejects.toThrow("Couldn't reach Google. Try again.");
    const html = harness(() => new Response('<html>502</html>', { status: 502 }));
    await expect(html.api.markApplied({ posting_id: 'p1' })).rejects.toThrow("Couldn't reach Google. Try again.");
    let seen: AbortSignal | null | undefined;
    const slow = harness((_c, init) => new Promise<Response>((_res, rej) => {
      seen = init?.signal;
      seen?.addEventListener('abort', () => rej(seen?.reason));
    }), 20);
    await expect(slow.api.setApplicationStatus({ id: 1, company: 'Ramp', role: null }, 'x')).rejects.toThrow("Couldn't reach Google. Try again.");
    expect(seen).toBeInstanceOf(AbortSignal);
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
  it('setPrepProgress(null) deletes the row for that item', async () => {
    const { api, calls } = harness(empty);
    await api.setPrepProgress('cs-http', null);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url.pathname).toBe('/rest/v1/prep_progress');
    expect(calls[0].url.searchParams.get('item_id')).toBe('eq.cs-http');
  });
  it('setPrepProgress upserts on owner,item_id', async () => {
    const { api, calls } = harness(empty);
    await api.setPrepProgress('cs-http', 'learning');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.searchParams.get('on_conflict')).toBe('owner,item_id');
    expect(calls[0].body).toMatchObject({ owner: 'u1', item_id: 'cs-http', status: 'learning' });
  });
  it('saveCompanyPrep upserts on owner,company', async () => {
    const { api, calls } = harness(empty);
    await api.saveCompanyPrep({ company: 'Stripe', notes: 'n', links: '', interview_on: '2026-10-20' });
    expect(calls[0].url.pathname).toBe('/rest/v1/company_prep');
    expect(calls[0].url.searchParams.get('on_conflict')).toBe('owner,company');
    expect(calls[0].body).toMatchObject({ owner: 'u1', company: 'Stripe', interview_on: '2026-10-20' });
  });
  it('listPrepSessions filters by day', async () => {
    const { api, calls } = harness(() => json([]));
    await api.listPrepSessions('2026-01-01');
    expect(calls[0].url.searchParams.get('happened_on')).toBe('gte.2026-01-01');
  });
  it('listIdeas selects started_at', async () => {
    const { api, calls } = harness(() => json([]));
    await api.listIdeas();
    expect(calls[0].url.searchParams.get('select')).toContain('started_at');
  });
  it('listReferrals is empty before migration 0011 adds the table', async () => {
    const before = harness(() => json({ code: '42P01', message: 'relation "public.referrals" does not exist' }, 404));
    expect(await before.api.listReferrals()).toEqual([]);
    const other = harness(() => json({ message: 'permission denied for table referrals' }, 403));
    await expect(other.api.listReferrals()).rejects.toThrow('permission denied');
  });
  it('findEngineers queues a find_engineers launch with the job', async () => {
    const h = harness(() => json(null, 201));
    await h.api.findEngineers({ posting_id: 'p1', job_url: 'https://x/1', company: 'Stripe', role: 'SWE', tier: 'reach' });
    expect(h.calls[0].body).toEqual({ kind: 'find_engineers',
      payload: { company: 'Stripe', role: 'SWE', tier: 'reach', posting_id: 'p1', job_url: 'https://x/1' } });
  });
});
