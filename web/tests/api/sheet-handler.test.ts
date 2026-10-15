// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The handler's auth, owner check, Supabase payloads and error mapping. createClient is mocked; Google is a mocked fetch.
type Result = { data: unknown; error: unknown };
const sb = {
  getUser: async (): Promise<{ data: { user: unknown }; error: unknown }> => ({ data: { user: { id: 'u1' } }, error: null }),
  tables: {} as Record<string, unknown>,
  writes: [] as { table: string; kind: string; payload: unknown; eq?: [string, unknown][] }[],
  created: [] as unknown[][],
};

function builder(table: string): unknown {
  const ctx: { kind: string; payload?: unknown; eq: [string, unknown][]; isNull?: string[] } = { kind: 'select', eq: [] };
  const result = (): Result => {
    const rows = (sb.tables[table] ?? []) as Record<string, unknown>[];
    const hit = rows.filter((r) => ctx.eq.every(([k, v]) => r[k] === v));
    if (ctx.kind !== 'select') {
      sb.writes.push({ table, kind: ctx.kind, payload: ctx.payload, eq: ctx.eq.length ? ctx.eq.map(([k, v]) => [ctx.isNull?.includes(k) ? `is:${k}` : k, v] as [string, unknown]) : undefined });
      return { data: ctx.kind === 'update' ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: hit[0] ?? null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b, limit: () => b,
    eq: (k: string, v: unknown) => { ctx.eq.push([k, v]); return b; },
    is: (k: string, v: unknown) => { ctx.isNull = [...(ctx.isNull ?? []), k]; ctx.eq.push([k, v]); return b; },
    update: (p: unknown) => { ctx.kind = 'update'; ctx.payload = p; return b; },
    insert: (p: unknown) => { ctx.kind = 'insert'; ctx.payload = p; return b; },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (res: (r: Result) => unknown) => Promise.resolve(result()).then(res),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    sb.created.push(args);
    return { auth: { getUser: () => sb.getUser() }, from: (t: string) => builder(t) };
  },
}));

const mod = await import('../../api/sheet');
const handler = mod.default;

class FakeRes {
  code = 0;
  body: unknown = undefined;
  headers: Record<string, string> = {};
  status(c: number): this { this.code = c; return this; }
  json(b: unknown): this { this.body = b; return this; }
  setHeader(k: string, v: string): this { this.headers[k] = v; return this; }
}
const TOKEN = 'user-token-xyz';
const call = async (method: string, body?: unknown, query: Record<string, string> = {}, auth: string | undefined = `Bearer ${TOKEN}`) => {
  const res = new FakeRes();
  await handler({ method, headers: auth ? { authorization: auth } : {}, query, body } as unknown as VercelRequest, res as unknown as VercelResponse);
  return res;
};

const SET = { op: 'set_status', application_id: 11, company: 'Ramp', role: 'Software Engineer Intern', sheet_row: 3, status: 'OA invited' };
const HEADER = ['Company', 'Role / title', 'Track', 'Start / term', 'Location', 'Status', 'Priority', 'Applied date'];
const VALUES = [[], HEADER, ['Ramp', 'Software Engineer Intern', 'Internship', '', '', 'Applied', 'Unranked', '10/8/2026']];
const META = { sheets: [{ tables: [{ name: 'ApplicationsTable', columnProperties: [{ columnName: 'Status', dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Applied' }, { userEnteredValue: 'OA invited' }] } } }] }] }] };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA_JSON = JSON.stringify({ client_email: 'bot@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });

let google: { fail?: number; throws?: boolean; calls: string[] };
function stubGoogle() {
  google = { calls: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    google.calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (google.throws) throw new TypeError('fetch failed');
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'g-tok', expires_in: 3600 }));
    if (google.fail) return new Response('{"error":{"message":"Google secret detail"}}', { status: google.fail });
    if (url.includes(':append')) return new Response(JSON.stringify({ updates: { updatedRange: 'Applications!A4:H4' } }));
    if (url.includes('/values/')) return new Response(init?.method === 'PUT' ? '{}' : JSON.stringify({ values: VALUES }));
    return new Response(JSON.stringify(META));
  }));
}

describe('sheet handler', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://p.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('GOOGLE_SA_JSON', SA_JSON);
    vi.stubEnv('SHEET_ID', 'SHEET123');
    vi.stubEnv('LOCKIN_OWNER_ID', 'u1');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mod.resetTokenCache();
    stubGoogle();
    sb.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
    sb.tables = {
      settings: [{ owner: 'u1' }],
      applications: [{ id: 11, company: 'Ramp', role: 'Software Engineer Intern', status: 'Applied', sheet_row: 3 }],
      postings: [{ id: 'p1', company: 'Stripe', title: 'SWE Intern', term: 'Winter 2027', location: 'Chicago, IL', url: 'https://x/1' }],
      outreach: [],
    };
    sb.writes = [];
    sb.created = [];
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); errSpy.mockRestore(); });

  it('requires a bearer token', async () => {
    const res = await call('GET', undefined, { op: 'statuses' }, '');
    expect(res.code).toBe(401);
    expect(google.calls).toEqual([]);
  });
  it('rejects an invalid session with 401', async () => {
    sb.getUser = async () => ({ data: { user: null }, error: { status: 401, message: 'bad jwt' } });
    expect((await call('GET', undefined, { op: 'statuses' })).code).toBe(401);
  });
  it('rejects any user other than LOCKIN_OWNER_ID with 403 "Not allowed.", before touching Google', async () => {
    sb.getUser = async () => ({ data: { user: { id: 'someone-else' } }, error: null });
    sb.tables.settings = [{ owner: 'someone-else' }]; // even if RLS shows them their own settings row
    for (const [m, b, q] of [['POST', { op: 'applied', posting_id: 'p1' }, {}], ['POST', SET, {}], ['GET', undefined, { op: 'statuses' }]] as const) {
      const res = await call(m, b, q);
      expect(res.code).toBe(403);
      expect(res.body).toEqual({ error: 'Not allowed.' });
    }
    expect(google.calls).toEqual([]);
    expect(sb.writes).toEqual([]);
  });
  it('fails closed with 500 when LOCKIN_OWNER_ID is unset', async () => {
    vi.stubEnv('LOCKIN_OWNER_ID', '');
    const res = await call('POST', { op: 'applied', posting_id: 'p1' });
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: "Sheet writes aren't configured." });
    expect(google.calls).toEqual([]);
    expect(sb.created).toEqual([]);
  });
  it('rejects a user who does not own the settings row with 403, before touching Google', async () => {
    sb.getUser = async () => ({ data: { user: { id: 'intruder' } }, error: null });
    const res = await call('POST', { op: 'applied', posting_id: 'p1' });
    expect(res.code).toBe(403);
    expect(google.calls).toEqual([]);
    sb.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
    sb.tables.settings = [];
    expect((await call('GET', undefined, { op: 'statuses' })).code).toBe(403);
  });
  it('builds the Supabase client as the user (anon key + bearer), never the service role', async () => {
    await call('GET', undefined, { op: 'statuses' });
    const [url, key, opts] = sb.created[0] as [string, string, { global: { headers: Record<string, string> } }];
    expect([url, key]).toEqual(['https://p.supabase.co', 'anon']);
    expect(opts.global.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
  it('GET statuses returns the dropdown options and only reads the env Sheet', async () => {
    const res = await call('GET', undefined, { op: 'statuses', sheet_id: 'EVIL' });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ statuses: ['Applied', 'OA invited'] });
    const sheetCalls = google.calls.filter((c) => c.includes('sheets.googleapis.com'));
    expect(sheetCalls.length).toBeGreaterThan(0);
    for (const c of sheetCalls) expect(c).toContain('/spreadsheets/SHEET123');
  });
  it('set_status writes one cell and updates the application row as the user', async () => {
    const res = await call('POST', SET);
    expect(res.code).toBe(200);
    expect(google.calls.filter((c) => c.startsWith('PUT') || c.startsWith('POST https://sheets'))).toEqual([
      'PUT https://sheets.googleapis.com/v4/spreadsheets/SHEET123/values/Applications!F3?valueInputOption=USER_ENTERED',
    ]);
    expect(sb.writes).toEqual([{ table: 'applications', kind: 'update', payload: { status: 'OA invited', stage: 'oa', sheet_row: 3 }, eq: [['id', 11]] }]);
    expect(res.body).toEqual({ ok: true, synced: true });
  });
  it('set_status with a stale id updates by sheet_row + company, then company + role (role null → is null)', async () => {
    sb.tables.applications = [{ id: 900, company: 'Ramp', role: 'Software Engineer Intern', sheet_row: null }];
    const res = await call('POST', { ...SET, application_id: 11 });
    expect(res.body).toEqual({ ok: true, synced: true });
    expect(sb.writes.map((w) => w.eq)).toEqual([
      [['sheet_row', 3], ['company', 'Ramp']],
      [['role', 'Software Engineer Intern'], ['company', 'Ramp']],
    ]);    // a null role matches with IS NULL (via .is), never eq('role', null)
    sb.writes = [];
    sb.tables.applications = [{ id: 901, company: 'Visa', role: null, sheet_row: null }];
    VALUES.push(['Visa']);
    try {
      expect((await call('POST', { ...SET, company: 'Visa', role: null, sheet_row: undefined })).body).toEqual({ ok: true, synced: true });
    } finally { VALUES.pop(); }
    expect(sb.writes.at(-1)?.eq).toEqual([['is:role', null], ['company', 'Visa']]);
  });
  it('set_status where no app row matches after the write is ok, synced:false', async () => {
    sb.tables.applications = [];
    const res = await call('POST', SET);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ ok: true, synced: false });
  });
  it('applied inserts the application (sheet_row from updatedRange) and marks the posting applied', async () => {
    const res = await call('POST', { op: 'applied', posting_id: 'p1' });
    expect(res.code).toBe(200);
    expect(sb.writes).toEqual([
      { table: 'applications', kind: 'insert', payload: expect.objectContaining({ company: 'Stripe', role: 'SWE Intern', status: 'Applied', stage: 'applied', priority: 'Unranked', track: 'Internship', sheet_row: 4 }), eq: undefined },
      { table: 'postings', kind: 'update', payload: { status: 'applied' }, eq: [['id', 'p1']] },
    ]);
  });
  it('bad requests are 400; other methods 405', async () => {
    expect((await call('POST', { op: 'nope' })).code).toBe(400);
    const res = await call('DELETE');
    expect(res.code).toBe(405);
  });
  it('Google failures are 502 with the fixed message and never echo the Google body or token', async () => {
    google.fail = 403;
    const res = await call('POST', SET);
    expect(res.code).toBe(502);
    expect(res.body).toEqual({ error: "Couldn't reach Google. Try again." });
    const logged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain('secret detail');
    expect(logged).not.toContain(TOKEN);
    google.fail = undefined;
    google.throws = true;
    expect((await call('GET', undefined, { op: 'statuses' })).code).toBe(502);
  });
  it('missing Google env is a 500 "not configured"', async () => {
    vi.stubEnv('GOOGLE_SA_JSON', '');
    const res = await call('GET', undefined, { op: 'statuses' });
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: "Sheet writes aren't configured." });
  });
});
