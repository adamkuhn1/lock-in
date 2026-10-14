import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const LC_GRAPHQL = 'https://leetcode.com/graphql';
export const RECENT_QUERY = 'query($u:String!){recentAcSubmissionList(username:$u,limit:20){title titleSlug timestamp}}';
export const MIN_GAP_MS = 60_000;
export const STATE_KEY = 'web_sync';
export const LC_TIMEOUT_MS = 8_000;

export interface FetchedSolve { slug: string; title: string; accepted_at: string }
export interface ExistingSolve { slug: string; accepted_at: string }
export type ServerSyncResult = { status: 'ok'; added: number } | { status: 'skipped' };

export class LeetCodeError extends Error {}

export function parseRecent(body: unknown): FetchedSolve[] {
  if (!body || typeof body !== 'object') throw new LeetCodeError('LeetCode returned no JSON');
  const b = body as { data?: { recentAcSubmissionList?: unknown }; errors?: unknown };
  if (b.errors) throw new LeetCodeError(`LeetCode GraphQL error: ${JSON.stringify(b.errors).slice(0, 200)}`);
  const list = b.data?.recentAcSubmissionList;
  if (list === null) return [];
  if (!Array.isArray(list)) throw new LeetCodeError('unexpected LeetCode response shape');
  return list.flatMap((row: unknown) => {
    const r = row as Record<string, unknown>;
    const ts = Number(r.timestamp);
    if (typeof r.titleSlug !== 'string' || typeof r.title !== 'string' || !Number.isFinite(ts)) return [];
    return [{ slug: r.titleSlug, title: r.title, accepted_at: new Date(ts * 1000).toISOString() }];
  });
}

const key = (slug: string, iso: string) => `${slug}|${Date.parse(iso)}`;

export function newSolves(fetched: FetchedSolve[], existing: ExistingSolve[]): FetchedSolve[] {
  const seen = new Set(existing.map((e) => key(e.slug, e.accepted_at)));
  return fetched.filter((s) => {
    const k = key(s.slug, s.accepted_at);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function shouldSkip(lastIso: string | null, now: Date): boolean {
  return lastIso !== null && now.getTime() - Date.parse(lastIso) < MIN_GAP_MS;
}

export async function fetchRecent(username: string, fetchImpl: typeof fetch = fetch, timeoutMs = LC_TIMEOUT_MS): Promise<FetchedSolve[]> {
  let res: Response;
  try {
    res = await fetchImpl(LC_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' },
      body: JSON.stringify({ query: RECENT_QUERY, variables: { u: username } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new LeetCodeError(timedOut ? 'LeetCode timed out' : 'LeetCode unreachable');
  }
  if (!res.ok) throw new LeetCodeError(`LeetCode HTTP ${res.status}`);
  return parseRecent(await res.json().catch(() => null));
}

export interface SyncStore {
  lastSyncAt(): Promise<string | null>;
  markSync(at: string): Promise<void>;
  username(): Promise<string>;
  existingSince(iso: string): Promise<ExistingSolve[]>;
  insert(rows: FetchedSolve[]): Promise<void>;
}

export async function runSync(store: SyncStore, now: Date, fetchImpl: typeof fetch = fetch): Promise<ServerSyncResult> {
  if (shouldSkip(await store.lastSyncAt(), now)) return { status: 'skipped' };
  await store.markSync(now.toISOString());
  const fetched = await fetchRecent(await store.username(), fetchImpl);
  if (!fetched.length) return { status: 'ok', added: 0 };
  const oldest = fetched.reduce((m, s) => (Date.parse(s.accepted_at) < Date.parse(m) ? s.accepted_at : m), fetched[0].accepted_at);
  const fresh = newSolves(fetched, await store.existingSince(oldest));
  if (fresh.length) await store.insert(fresh);
  return { status: 'ok', added: fresh.length };
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export function supabaseStore(sb: SupabaseClient): SyncStore {
  return {
    async lastSyncAt() {
      const { data, error } = await sb.from('worker_state').select('value').eq('key', STATE_KEY).maybeSingle();
      check(error);
      return ((data?.value ?? null) as { at?: string } | null)?.at ?? null;
    },
    async markSync(at) {
      const { error } = await sb.from('worker_state').upsert({ key: STATE_KEY, value: { at } }, { onConflict: 'owner,key' });
      check(error);
    },
    async username() {
      const { data, error } = await sb.from('settings').select('lc_username').limit(1).maybeSingle();
      check(error);
      return (data?.lc_username as string | undefined) || 'adamkuhn';
    },
    async existingSince(iso) {
      const { data, error } = await sb.from('lc_solves').select('slug,accepted_at').gte('accepted_at', iso);
      check(error);
      return (data ?? []) as ExistingSolve[];
    },
    async insert(rows) {
      // ignoreDuplicates → ON CONFLICT DO NOTHING, so a race with the worker's 30-min sync is harmless.
      const { error } = await sb.from('lc_solves')
        .upsert(rows.map((r) => ({ ...r, rating: null })), { onConflict: 'owner,slug,accepted_at', ignoreDuplicates: true });
      check(error);
    },
  };
}

export function bearer(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(.+)$/i.exec(h ?? '');
  return m ? m[1].trim() : null;
}

const GENERIC = 'Sync failed';

/** Supabase Auth rejected the token (vs. Auth being unreachable or erroring). */
function isAuthRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

const detail = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  const token = bearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error('sync-leetcode: server is missing SUPABASE_URL / SUPABASE_ANON_KEY');
    return res.status(500).json({ error: GENERIC });
  }
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error && !isAuthRejection(error)) {
      console.error('sync-leetcode: getUser failed:', (error as { message?: string }).message ?? 'unknown');
      return res.status(503).json({ error: 'Try again' });
    }
    if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });
  } catch (e) {
    console.error('sync-leetcode: getUser threw:', detail(e));
    return res.status(503).json({ error: 'Try again' });
  }
  try {
    return res.status(200).json(await runSync(supabaseStore(sb), new Date()));
  } catch (e) {
    if (e instanceof LeetCodeError) return res.status(502).json({ error: e.message.slice(0, 300) });
    // Never echo internal detail (or the token) to the client.
    console.error('sync-leetcode: sync failed:', detail(e));
    return res.status(500).json({ error: GENERIC });
  }
}
