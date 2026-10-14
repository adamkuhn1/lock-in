import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describe, expect, it, vi } from 'vitest';
import handler, {
  LC_GRAPHQL, LeetCodeError, bearer, fetchRecent, newSolves, parseRecent, runSync, shouldSkip, type ExistingSolve, type FetchedSolve, type SyncStore,
} from '../../api/sync-leetcode';

const BODY = {
  data: {
    recentAcSubmissionList: [
      { title: 'Daily Temperatures', titleSlug: 'daily-temperatures', timestamp: '1791933317' },
      { title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1791830000' },
      { title: 'Broken', titleSlug: 'broken', timestamp: 'not-a-number' },
    ],
  },
};

describe('parseRecent', () => {
  it('maps to ISO UTC and skips malformed rows', () => {
    expect(parseRecent(BODY)).toEqual([
      { slug: 'daily-temperatures', title: 'Daily Temperatures', accepted_at: new Date(1791933317 * 1000).toISOString() },
      { slug: 'two-sum', title: 'Two Sum', accepted_at: new Date(1791830000 * 1000).toISOString() },
    ]);
  });
  it('null list (no submissions) is empty', () => {
    expect(parseRecent({ data: { recentAcSubmissionList: null } })).toEqual([]);
  });
  it('GraphQL errors and junk throw LeetCodeError', () => {
    expect(() => parseRecent({ errors: [{ message: 'rate limited' }] })).toThrow(LeetCodeError);
    expect(() => parseRecent(null)).toThrow(LeetCodeError);
    expect(() => parseRecent({ data: { recentAcSubmissionList: 'x' } })).toThrow('unexpected LeetCode response');
  });
});

describe('newSolves', () => {
  it('dedupes against existing rows written by the worker in a different ISO format', () => {
    const fetched: FetchedSolve[] = [
      { slug: 'two-sum', title: 'Two Sum', accepted_at: '2026-10-14T13:00:00.000Z' },
      { slug: 'two-sum', title: 'Two Sum', accepted_at: '2026-10-14T15:00:00.000Z' },
      { slug: 'two-sum', title: 'Two Sum', accepted_at: '2026-10-14T15:00:00.000Z' },
    ];
    const existing = [{ slug: 'two-sum', accepted_at: '2026-10-14T13:00:00+00:00' }];
    expect(newSolves(fetched, existing).map((s) => s.accepted_at)).toEqual(['2026-10-14T15:00:00.000Z']);
  });
});

describe('shouldSkip', () => {
  const now = new Date('2026-10-14T16:00:00Z');
  it('skips within 60 s of the last call', () => {
    expect(shouldSkip(null, now)).toBe(false);
    expect(shouldSkip('2026-10-14T15:59:30Z', now)).toBe(true);
    expect(shouldSkip('2026-10-14T15:58:59Z', now)).toBe(false);
  });
});

function memoryStore(last: string | null = null, existing: ExistingSolve[] = []) {
  const state = { last, inserted: [] as FetchedSolve[], marks: [] as string[] };
  const store: SyncStore = {
    lastSyncAt: async () => state.last,
    markSync: async (at) => { state.marks.push(at); state.last = at; },
    username: async () => 'adamkuhn',
    existingSince: async () => existing,
    insert: async (rows) => { state.inserted.push(...rows); },
  };
  return { state, store };
}
const lcFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('fetchRecent timeout (I5)', () => {
  it('aborts a hung LeetCode call and throws LeetCodeError', async () => {
    let seen: AbortSignal | null | undefined;
    const hung = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      seen = init?.signal;
      seen?.addEventListener('abort', () => rej(seen?.reason));
    }));
    await expect(fetchRecent('adamkuhn', hung as unknown as typeof fetch, 20)).rejects.toBeInstanceOf(LeetCodeError);
    expect(seen).toBeInstanceOf(AbortSignal);
  });
  it('a network failure is a LeetCodeError too', async () => {
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(fetchRecent('adamkuhn', down as unknown as typeof fetch)).rejects.toBeInstanceOf(LeetCodeError);
  });
});

describe('runSync', () => {
  const now = new Date('2026-10-14T16:00:00Z');
  it('marks, fetches with the right request, inserts only new rows', async () => {
    const m = memoryStore(null, [{ slug: 'two-sum', accepted_at: new Date(1791830000 * 1000).toISOString() }]);
    const f = lcFetch(BODY);
    expect(await runSync(m.store, now, f as unknown as typeof fetch)).toEqual({ status: 'ok', added: 1 });
    expect(m.state.inserted.map((r) => r.slug)).toEqual(['daily-temperatures']);
    expect(m.state.marks).toEqual([now.toISOString()]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LC_GRAPHQL);
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Referer: 'https://leetcode.com' });
    expect(JSON.parse(String(init.body)).variables).toEqual({ u: 'adamkuhn' });
  });
  it('a second call within a minute does not hit LeetCode', async () => {
    const m = memoryStore('2026-10-14T15:59:40Z');
    const f = lcFetch(BODY);
    expect(await runSync(m.store, now, f as unknown as typeof fetch)).toEqual({ status: 'skipped' });
    expect(f).not.toHaveBeenCalled();
  });
  it('LeetCode down: throws LeetCodeError, but the attempt is still recorded', async () => {
    const m = memoryStore();
    await expect(runSync(m.store, now, lcFetch({}, 503) as unknown as typeof fetch)).rejects.toThrow('LeetCode HTTP 503');
    expect(m.state.marks).toHaveLength(1);
  });
  it('nothing new: no insert call', async () => {
    const m = memoryStore(null, BODY.data.recentAcSubmissionList.slice(0, 2).map((r) => ({ slug: r.titleSlug, accepted_at: new Date(Number(r.timestamp) * 1000).toISOString() })));
    expect(await runSync(m.store, now, lcFetch(BODY) as unknown as typeof fetch)).toEqual({ status: 'ok', added: 0 });
    expect(m.state.inserted).toEqual([]);
  });
});

describe('handler', () => {
  class FakeRes {
    code = 0;
    body: unknown = undefined;
    headers: Record<string, string> = {};
    status(c: number): this { this.code = c; return this; }
    json(b: unknown): this { this.body = b; return this; }
    setHeader(k: string, v: string): this { this.headers[k] = v; return this; }
  }
  it('bearer parsing', () => {
    expect(bearer('Bearer abc.def')).toBe('abc.def');
    expect(bearer('bearer  xyz ')).toBe('xyz');
    expect(bearer('Basic abc')).toBeNull();
    expect(bearer(undefined)).toBeNull();
  });
  it('405 for GET, 401 without a token', async () => {
    const get = new FakeRes();
    await handler({ method: 'GET', headers: {} } as VercelRequest, get as unknown as VercelResponse);
    expect([get.code, get.headers.Allow]).toEqual([405, 'POST']);
    const anon = new FakeRes();
    await handler({ method: 'POST', headers: {} } as VercelRequest, anon as unknown as VercelResponse);
    expect(anon.code).toBe(401);
  });
});
