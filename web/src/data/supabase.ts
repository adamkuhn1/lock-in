import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AlreadyCountedError, type DataApi } from './api';
import type {
  Application, CalEvent, Commit, CompanyPrep, Contact, DailySet, Idea, LaunchRequest, Outreach, Posting, PrepItem, PrepProgress,
  PrepSession, Problem, ProblemState, Project, Settings, Solve, Story, SyncResult, SyncStatus, Topic, TopicState,
} from './types';

type PgError = { message: string } | null;

async function rows<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

const PAGE = 1000;

/** PostgREST caps responses at 1000 rows, so page with .range() until a short page. The builder must order by a stable key. */
export async function allPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await rows<T[]>(build(from, from + PAGE - 1));
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Only unapplied solves can still be rated; the worker applies each solve once. */
export { canRate } from '../lib/today';

async function exec(p: PromiseLike<{ error: PgError }>): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

export function createSupabase(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (or run with VITE_DEMO=1).');
  return createClient(url, key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export interface SupabaseApiDeps {
  ownerId(): Promise<string>;
  accessToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Client-side cap on /api/sync-leetcode; the server caps LeetCode at 8 s. Also caps /api/sheet in tests. */
  syncTimeoutMs?: number;
}

export const SYNC_TIMEOUT_MS = 12_000;
/** Client-side cap on /api/sheet; the server caps each Google call at 8 s and makes up to four (token, values, meta, write). */
export const SHEET_TIMEOUT_MS = 40_000;
export const SHEET_FAIL = "Couldn't reach Google. Try again.";

export function sessionDeps(sb: SupabaseClient): SupabaseApiDeps {
  return {
    async ownerId() {
      const { data } = await sb.auth.getSession();
      const id = data.session?.user.id;
      if (!id) throw new Error('Signed out');
      return id;
    },
    async accessToken() {
      return (await sb.auth.getSession()).data.session?.access_token ?? null;
    },
  };
}

export function createSupabaseApi(sb: SupabaseClient, deps: SupabaseApiDeps = sessionDeps(sb)): DataApi {
  const doFetch: typeof fetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));

  const requestLaunch: DataApi['requestLaunch'] = (kind, payload) =>
    exec(sb.from('launch_requests').insert({ kind, payload }));

  const queueWith = async (kind: 'outreach' | 'tailor_resume', i: { job_url: string; company?: string | null; role?: string | null }) => {
    const o = await rows<Outreach>(sb.from('outreach')
      .insert({ job_url: i.job_url, company: i.company ?? null, role: i.role ?? null }).select().single());
    await requestLaunch(kind, { outreach_id: o.id, job_url: o.job_url });
    return o;
  };

  /** Calls /api/sheet as the user. Resolves to [status, body]; throws Error(short message) on network/timeout/non-JSON. */
  const sheetCall = async (init: { query?: string; body?: unknown }): Promise<[number, Record<string, unknown>]> => {
    const token = await deps.accessToken();
    if (!token) throw new Error('Signed out');
    let res: Response;
    try {
      res = await doFetch(`/api/sheet${init.query ?? ''}`, {
        method: init.body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(deps.syncTimeoutMs ?? SHEET_TIMEOUT_MS),
      });
    } catch {
      throw new Error(SHEET_FAIL);
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new Error(SHEET_FAIL);
    return [res.status, body];
  };
  const sheetError = (body: Record<string, unknown>) => new Error(typeof body.error === 'string' ? body.error : SHEET_FAIL);

  return {
    async getSettings() {
      const list = await rows<Settings[]>(sb.from('settings').select('*').limit(1));
      if (!list.length) throw new Error('No settings row yet. Run the seed script (Plan 1 Task 11).');
      return list[0];
    },
    async updateSettings(patch) {
      await exec(sb.from('settings').update(patch).eq('owner', await deps.ownerId()));
    },
    async getDailySet(day) {
      const list = await rows<DailySet[]>(sb.from('lc_daily_sets').select('day,focus,mixed_day,items').eq('day', day).limit(1));
      return list[0] ?? null;
    },
    listProblems: () =>
      rows<Problem[]>(sb.from('problems').select('slug,lc_id,title,difficulty,topic,lists,paid_only,ac_rate,target_minutes,neetcode_link')),
    listTopics: () => rows<Topic[]>(sb.from('topics').select('name,ord,tier,prereqs,lc_tags').order('ord')),
    listTopicStates: () => rows<TopicState[]>(sb.from('lc_topic_state').select('topic,level')),
    listProblemStates: () => rows<ProblemState[]>(sb.from('lc_problem_state').select('slug,state,interval_days,due_on,lapses')),
    listSolves: () =>
      allPages<Solve>((a, b) => sb.from('lc_solves').select('id,slug,title,accepted_at,rating,rated_at,applied_at,slot,note')
        .order('accepted_at', { ascending: false }).order('id', { ascending: false }).range(a, b)),
    async rateSolve(id, rating, at) {
      // Guard: only an unapplied solve can be rated. Zero rows back means the worker got there first.
      const hit = await rows<{ id: number }[] | null>(sb.from('lc_solves').update({ rating, rated_at: at.toISOString() })
        .eq('id', id).is('applied_at', null).select('id'));
      if (!hit?.length) throw new AlreadyCountedError();
    },
    listProjects: () => rows<Project[]>(sb.from('projects').select('id,name,repo,local_path,active').order('name')),
    addProject: (p) => exec(sb.from('projects').insert({ ...p, active: true })),
    setProjectActive: (id, active) => exec(sb.from('projects').update({ active }).eq('id', id)),
    listCommits: (since) =>
      allPages<Commit>((a, b) => sb.from('commits').select('sha,project_id,message,committed_at').gte('committed_at', since)
        .order('committed_at', { ascending: false }).order('sha').range(a, b)),
    listIdeas: () =>
      allPages<Idea>((a, b) => sb.from('ideas').select('id,project_id,text,size,status,source,position,today_on,done_at,started_at,created_at')
        .order('position').order('id').range(a, b)),
    addIdea: (i) => exec(sb.from('ideas').insert({ ...i, status: 'todo', source: 'me' })),
    updateIdea: (id, patch) => exec(sb.from('ideas').update(patch).eq('id', id)),
    async listApplications() {
      const cols = 'id,company,role,track,term,location,status,stage,priority,applied_on';
      const page = (select: string) => allPages<Application>((a, b) => sb.from('applications').select(select).order('id').range(a, b));
      try {
        return await page(`${cols},sheet_row`);
      } catch (e) {
        // Before migration 0005 the column doesn't exist; the app still works without it.
        if (e instanceof Error && /sheet_row.*(does not exist|schema cache)|column.*sheet_row/i.test(e.message)) return page(cols);
        throw e;
      }
    },
    async listPostings(since) {
      const cols = 'id,company,title,location,url,term,posted_at,tier,starred,status,found_at';
      const page = (select: string) => allPages<Posting>((a, b) => sb.from('postings').select(select)
        .in('status', ['new', 'seen']).gte('found_at', since).order('found_at', { ascending: false }).order('id').range(a, b));
      try {
        return await page(`${cols},fit_rank,fit_reason,found_by`);
      } catch (e) {
        // Before migration 0009 the Best fit columns don't exist; nothing is on the shortlist.
        if (e instanceof Error && /(fit_rank|fit_reason|found_by).*(does not exist|schema cache)|column.*(fit_rank|fit_reason|found_by)/i.test(e.message)) return page(cols);
        throw e;
      }
    },
    setPostingStatus: (id, status) => exec(sb.from('postings').update({ status }).eq('id', id)),
    async listOutreach() {
      const cols = 'id,job_url,company,role,resume_path,status,sent_on,follow_up_on,created_at';
      const page = (select: string) => allPages<Outreach>((a, b) => sb.from('outreach').select(select)
        .order('created_at', { ascending: false }).order('id').range(a, b));
      try {
        return await page(`${cols},followups`);
      } catch (e) {
        // Before migration 0006 the column doesn't exist; every row reads as no follow-ups sent.
        if (e instanceof Error && /followups.*(does not exist|schema cache)|column.*followups/i.test(e.message)) return (await page(cols)).map((o) => ({ ...o, followups: 0 }));
        throw e;
      }
    },
    listContacts: () =>
      allPages<Contact>((a, b) => sb.from('contacts')
        .select('id,outreach_id,name,title,linkedin_url,email_guess,email_confidence,why,draft_subject,draft_body').order('id').range(a, b)),
    queueOutreach: (i) => queueWith('outreach', i),
    queueTailor: (i) => queueWith('tailor_resume', i),
    updateOutreach: (id, patch) => exec(sb.from('outreach').update(patch).eq('id', id)),
    requestLaunch,
    listLaunchRequests: () =>
      rows<LaunchRequest[]>(sb.from('launch_requests').select('id,kind,payload,status,error,created_at')
        .order('created_at', { ascending: false }).limit(50)),
    updateProject: (id, patch) => exec(sb.from('projects').update(patch).eq('id', id)),
    listStories: () =>
      allPages<Story>((a, b) => sb.from('stories').select('id,title,tags,situation,task,action,result,last_practiced_on,created_at')
        .order('created_at').order('id').range(a, b)),
    addStory: (s) => exec(sb.from('stories').insert(s)),
    updateStory: (id, patch) => exec(sb.from('stories').update(patch).eq('id', id)),
    deleteStory: (id) => exec(sb.from('stories').delete().eq('id', id)),
    listPrepSessions: (since) =>
      allPages<PrepSession>((a, b) => sb.from('prep_sessions').select('id,kind,minutes,note,company,story_id,happened_on,created_at')
        .gte('happened_on', since).order('happened_on', { ascending: false }).order('id').range(a, b)),
    addPrepSession: (s) => exec(sb.from('prep_sessions').insert(s)),
    listPrepItems: () => rows<PrepItem[]>(sb.from('prep_items').select('id,track,title,ord').order('track').order('ord')),
    listPrepProgress: () => rows<PrepProgress[]>(sb.from('prep_progress').select('item_id,status')),
    async setPrepProgress(itemId, status) {
      if (status === null) {
        await exec(sb.from('prep_progress').delete().eq('item_id', itemId));
        return;
      }
      await exec(sb.from('prep_progress').upsert(
        { owner: await deps.ownerId(), item_id: itemId, status, updated_at: new Date().toISOString() },
        { onConflict: 'owner,item_id' }));
    },
    listCompanyPrep: () => rows<CompanyPrep[]>(sb.from('company_prep').select('id,company,notes,links,interview_on,created_at').order('company')),
    async saveCompanyPrep(p) {
      await exec(sb.from('company_prep').upsert({ ...p, owner: await deps.ownerId() }, { onConflict: 'owner,company' }));
    },
    listEvents: () =>
      allPages<CalEvent>((a, b) => sb.from('events').select('id,title,kind,on_date,at_time,company,url,created_at')
        .order('on_date').order('id').range(a, b)),
    addEvent: (e) => exec(sb.from('events').insert(e)),
    deleteEvent: (id) => exec(sb.from('events').delete().eq('id', id)),
    listSyncStatus: () => rows<SyncStatus[]>(sb.from('sync_status').select('source,last_ok_at,last_error,consecutive_failures')),
    async syncLeetCode(): Promise<SyncResult> {
      const token = await deps.accessToken();
      if (!token) return { status: 'error', message: 'Signed out' };
      let res: Response;
      try {
        res = await doFetch('/api/sync-leetcode', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(deps.syncTimeoutMs ?? SYNC_TIMEOUT_MS),
        });
      } catch (e) {
        return { status: 'error', message: e instanceof Error ? e.message : 'Network error' };
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | SyncResult | null;
      if (!res.ok) return { status: 'error', message: (body as { error?: string } | null)?.error ?? `HTTP ${res.status}` };
      return body as SyncResult;
    },
    async sheetStatuses() {
      const [status, body] = await sheetCall({ query: '?op=statuses' });
      if (status !== 200 || !Array.isArray(body.statuses)) throw sheetError(body);
      return body.statuses.filter((s): s is string => typeof s === 'string');
    },
    async setApplicationStatus(app, status) {
      const [code, body] = await sheetCall({ body: {
        op: 'set_status', application_id: app.id, company: app.company, role: app.role,
        ...(app.sheet_row ? { sheet_row: app.sheet_row } : {}), status,
      } });
      if (code !== 200) throw sheetError(body);
    },
    async markApplied(i) {
      const [code, body] = await sheetCall({ body: { op: 'applied', ...i } });
      if (code === 409 && body.duplicate === true) return { duplicate: true };
      if (code !== 200) throw sheetError(body);
      return {};
    },
    async undoApplied({ company, role, sheet_row }) {
      const [code, body] = await sheetCall({ body: { op: 'unapply', company, role, ...(sheet_row ? { sheet_row } : {}) } });
      if (code !== 200) throw sheetError(body);
    },
  };
}
