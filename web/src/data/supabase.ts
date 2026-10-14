import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AlreadyCountedError, type DataApi } from './api';
import type {
  Application, Commit, Contact, DailySet, Idea, LaunchRequest, Outreach, Posting, Problem, ProblemState, Project,
  Settings, Solve, SyncResult, SyncStatus, Topic, TopicState,
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
  /** Client-side cap on /api/sync-leetcode; the server caps LeetCode at 8 s. */
  syncTimeoutMs?: number;
}

export const SYNC_TIMEOUT_MS = 12_000;

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
      allPages<Idea>((a, b) => sb.from('ideas').select('id,project_id,text,size,status,source,position,today_on,done_at,created_at')
        .order('position').order('id').range(a, b)),
    addIdea: (i) => exec(sb.from('ideas').insert({ ...i, status: 'todo', source: 'me' })),
    updateIdea: (id, patch) => exec(sb.from('ideas').update(patch).eq('id', id)),
    listApplications: () =>
      allPages<Application>((a, b) => sb.from('applications').select('id,company,role,track,term,location,status,stage,priority,applied_on')
        .order('id').range(a, b)),
    listPostings: (since) =>
      allPages<Posting>((a, b) => sb.from('postings').select('id,company,title,location,url,term,posted_at,tier,starred,status,found_at')
        .in('status', ['new', 'seen']).gte('found_at', since).order('found_at', { ascending: false }).order('id').range(a, b)),
    setPostingStatus: (id, status) => exec(sb.from('postings').update({ status }).eq('id', id)),
    listOutreach: () =>
      allPages<Outreach>((a, b) => sb.from('outreach').select('id,job_url,company,role,resume_path,status,sent_on,follow_up_on,created_at')
        .order('created_at', { ascending: false }).order('id').range(a, b)),
    listContacts: () =>
      allPages<Contact>((a, b) => sb.from('contacts')
        .select('id,outreach_id,name,title,linkedin_url,email_guess,email_confidence,why,draft_subject,draft_body').order('id').range(a, b)),
    async queueOutreach(i) {
      const o = await rows<Outreach>(sb.from('outreach')
        .insert({ job_url: i.job_url, company: i.company ?? null, role: i.role ?? null }).select().single());
      await requestLaunch('outreach', { outreach_id: o.id, job_url: o.job_url });
      return o;
    },
    updateOutreach: (id, patch) => exec(sb.from('outreach').update(patch).eq('id', id)),
    requestLaunch,
    listLaunchRequests: () =>
      rows<LaunchRequest[]>(sb.from('launch_requests').select('id,kind,payload,status,error,created_at')
        .order('created_at', { ascending: false }).limit(50)),
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
  };
}
