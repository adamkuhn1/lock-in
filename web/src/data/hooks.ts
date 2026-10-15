import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DataApi } from './api';
import { useApi } from './context';
import { addDays, planDay } from '../lib/time';
import type {
  Application, CompanyPrepInput, Idea, MarkAppliedInput, IdeaPatch, LaunchKind, NewCalEvent, NewIdea, NewPrepSession, NewProject, OutreachPatch, PostingStatus,
  PrepStatus, Problem, ProjectPatch, Rating, SettingsPatch, Solve, StoryInput, StoryPatch,
} from './types';

export const keys = {
  settings: ['settings'],
  dailySet: (day: string) => ['dailySet', day],
  dailySets: ['dailySet'],
  problems: ['problems'],
  topics: ['topics'],
  topicStates: ['topicStates'],
  problemStates: ['problemStates'],
  solves: ['solves'],
  projects: ['projects'],
  commits: ['commits'],
  ideas: ['ideas'],
  applications: ['applications'],
  postings: ['postings'],
  outreach: ['outreach'],
  contacts: ['contacts'],
  launchRequests: ['launchRequests'],
  syncStatus: ['syncStatus'],
  stories: ['stories'],
  prepSessions: ['prepSessions'],
  prepItems: ['prepItems'],
  prepProgress: ['prepProgress'],
  companyPrep: ['companyPrep'],
  events: ['events'],
  sheetStatuses: ['sheetStatuses'],
} as const;

const HOUR = 3_600_000;
const sinceDays = (days: number) => new Date(Date.now() - days * 24 * HOUR).toISOString();

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const useSettings = () => { const api = useApi(); return useQuery({ queryKey: keys.settings, queryFn: () => api.getSettings() }); };
export const useDailySet = (day: string) => { const api = useApi(); return useQuery({ queryKey: keys.dailySet(day), queryFn: () => api.getDailySet(day) }); };
export const useProblems = () => { const api = useApi(); return useQuery({ queryKey: keys.problems, queryFn: () => api.listProblems(), staleTime: 24 * HOUR }); };
export function useProblemMap(): Map<string, Problem> {
  const { data } = useProblems();
  return useMemo(() => new Map((data ?? []).map((p) => [p.slug, p])), [data]);
}
export const useTopics = () => { const api = useApi(); return useQuery({ queryKey: keys.topics, queryFn: () => api.listTopics(), staleTime: 24 * HOUR }); };
export const useTopicStates = () => { const api = useApi(); return useQuery({ queryKey: keys.topicStates, queryFn: () => api.listTopicStates() }); };
export const useProblemStates = () => { const api = useApi(); return useQuery({ queryKey: keys.problemStates, queryFn: () => api.listProblemStates() }); };
export const useSolves = () => { const api = useApi(); return useQuery({ queryKey: keys.solves, queryFn: () => api.listSolves() }); };
export const useProjects = () => { const api = useApi(); return useQuery({ queryKey: keys.projects, queryFn: () => api.listProjects() }); };
export const useCommits = () => { const api = useApi(); return useQuery({ queryKey: keys.commits, queryFn: () => api.listCommits(sinceDays(365)) }); };
export const useIdeas = () => { const api = useApi(); return useQuery({ queryKey: keys.ideas, queryFn: () => api.listIdeas() }); };
export const useApplications = () => { const api = useApi(); return useQuery({ queryKey: keys.applications, queryFn: () => api.listApplications() }); };
export const usePostings = () => { const api = useApi(); return useQuery({ queryKey: keys.postings, queryFn: () => api.listPostings(sinceDays(30)) }); };
export const useOutreach = () => {
  const api = useApi();
  return useQuery({
    queryKey: keys.outreach, queryFn: () => api.listOutreach(),
    refetchInterval: (q) => (q.state.data?.some((o) => o.status === 'queued') ? 15_000 : false),
  });
};
export const useContacts = () => { const api = useApi(); return useQuery({ queryKey: keys.contacts, queryFn: () => api.listContacts() }); };
export const useLaunchRequests = () => {
  const api = useApi();
  return useQuery({
    queryKey: keys.launchRequests, queryFn: () => api.listLaunchRequests(),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued') ? 10_000 : false),
  });
};
export const useSyncStatus = () => { const api = useApi(); return useQuery({ queryKey: keys.syncStatus, queryFn: () => api.listSyncStatus() }); };

function useApiMutation<V, R = unknown>(fn: (api: DataApi, v: V) => Promise<R>, invalidate: QueryKey[]) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => fn(api, v),
    onSettled: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

export function useRateSolve() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; rating: Rating }) => api.rateSolve(v.id, v.rating, new Date()),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.solves });
      const prev = qc.getQueryData<Solve[]>(keys.solves);
      qc.setQueryData<Solve[]>(keys.solves, (list) => list?.map((s) => (s.id === v.id ? { ...s, rating: v.rating } : s)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(keys.solves, ctx.prev); },
    onSettled: () => Promise.all([keys.solves, keys.dailySets, keys.problemStates, keys.topicStates].map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

export const useUpdateSettings = () => useApiMutation((api, patch: SettingsPatch) => api.updateSettings(patch), [keys.settings]);
export const useAddProject = () => useApiMutation((api, p: NewProject) => api.addProject(p), [keys.projects]);
export const useSetProjectActive = () =>
  useApiMutation((api, v: { id: string; active: boolean }) => api.setProjectActive(v.id, v.active), [keys.projects]);
export const useAddIdea = () => useApiMutation((api, i: NewIdea) => api.addIdea(i), [keys.ideas]);
export const useUpdateIdea = () => useApiMutation((api, v: { id: string; patch: IdeaPatch }) => api.updateIdea(v.id, v.patch), [keys.ideas]);
export const useReorderIdeas = () =>
  useApiMutation((api, moves: { id: string; position: number }[]) =>
    Promise.all(moves.map((m) => api.updateIdea(m.id, { position: m.position }))), [keys.ideas]);
export const useSwapIdea = () =>
  useApiMutation(async (api, v: { fromId: string; toId: string; day: string }) => {
    await api.updateIdea(v.fromId, { status: 'todo', today_on: null });
    await api.updateIdea(v.toId, { status: 'today', today_on: v.day });
  }, [keys.ideas]);
export const useSetPostingStatus = () =>
  useApiMutation((api, v: { id: string; status: PostingStatus }) => api.setPostingStatus(v.id, v.status), [keys.postings]);
export const useQueueOutreach = () =>
  useApiMutation((api, v: { job_url: string; company?: string | null; role?: string | null }) => api.queueOutreach(v),
    [keys.outreach, keys.launchRequests]);
export const useQueueTailor = () =>
  useApiMutation((api, v: { job_url: string; company?: string | null; role?: string | null }) => api.queueTailor(v),
    [keys.outreach, keys.launchRequests]);
export const useUpdateOutreach = () =>
  useApiMutation((api, v: { id: string; patch: OutreachPatch }) => api.updateOutreach(v.id, v.patch), [keys.outreach]);
export const useRequestLaunch = () =>
  useApiMutation((api, v: { kind: LaunchKind; payload: Record<string, unknown> }) => api.requestLaunch(v.kind, v.payload),
    [keys.launchRequests]);

export function useSyncLeetCode() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.syncLeetCode(),
    onSuccess: (r) => {
      if (r.status === 'ok' && r.added > 0) {
        void qc.invalidateQueries({ queryKey: keys.solves });
        void qc.invalidateQueries({ queryKey: keys.dailySets });
        void qc.invalidateQueries({ queryKey: keys.problemStates });
        void qc.invalidateQueries({ queryKey: keys.topicStates });
      }
    },
  });
}

/** Sync LeetCode when the app opens and whenever it comes back to the foreground (at most once a minute). */
export function useSyncOnOpen() {
  const sync = useSyncLeetCode();
  const last = useRef(0);
  const { mutate } = sync;
  useEffect(() => {
    const go = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < 60_000) return;
      last.current = Date.now();
      mutate();
    };
    go();
    document.addEventListener('visibilitychange', go);
    return () => document.removeEventListener('visibilitychange', go);
  }, [mutate]);
  return sync;
}

export const useStories = () => { const api = useApi(); return useQuery({ queryKey: keys.stories, queryFn: () => api.listStories() }); };
export const usePrepSessions = () => {
  const api = useApi();
  return useQuery({ queryKey: keys.prepSessions, queryFn: () => api.listPrepSessions(addDays(planDay(new Date()), -400)) });
};
export const usePrepItems = () => { const api = useApi(); return useQuery({ queryKey: keys.prepItems, queryFn: () => api.listPrepItems(), staleTime: 24 * HOUR }); };
export const usePrepProgress = () => { const api = useApi(); return useQuery({ queryKey: keys.prepProgress, queryFn: () => api.listPrepProgress() }); };
export const useCompanyPrep = () => { const api = useApi(); return useQuery({ queryKey: keys.companyPrep, queryFn: () => api.listCompanyPrep() }); };
export const useEvents = () => { const api = useApi(); return useQuery({ queryKey: keys.events, queryFn: () => api.listEvents() }); };

export const useUpdateProject = () =>
  useApiMutation((api, v: { id: string; patch: ProjectPatch }) => api.updateProject(v.id, v.patch), [keys.projects]);
export const useAddStory = () => useApiMutation((api, s: StoryInput) => api.addStory(s), [keys.stories]);
export const useUpdateStory = () => useApiMutation((api, v: { id: string; patch: StoryPatch }) => api.updateStory(v.id, v.patch), [keys.stories]);
export const useDeleteStory = () => useApiMutation((api, id: string) => api.deleteStory(id), [keys.stories]);
export const usePracticeStory = () =>
  useApiMutation(async (api, v: { id: string; day: string }) => {
    await api.updateStory(v.id, { last_practiced_on: v.day });
    await api.addPrepSession({ kind: 'story', story_id: v.id, happened_on: v.day });
  }, [keys.stories, keys.prepSessions]);
export const useAddPrepSession = () => useApiMutation((api, s: NewPrepSession) => api.addPrepSession(s), [keys.prepSessions]);
export const useSetPrepProgress = () =>
  useApiMutation((api, v: { itemId: string; status: PrepStatus | null }) => api.setPrepProgress(v.itemId, v.status), [keys.prepProgress]);
export const useSaveCompanyPrep = () => useApiMutation((api, p: CompanyPrepInput) => api.saveCompanyPrep(p), [keys.companyPrep]);
export const useAddEvent = () => useApiMutation((api, e: NewCalEvent) => api.addEvent(e), [keys.events]);
export const useDeleteEvent = () => useApiMutation((api, id: string) => api.deleteEvent(id), [keys.events]);
/**
 * Two steps, and not idempotent: a repeat call for an idea already in flight is ignored. An id is released only
 * after the refetch has settled and the UI has had a turn to re-render with the new status, so a stale button
 * can't slip a second request through.
 */
export function useWorkOnIdea() {
  const api = useApi();
  const qc = useQueryClient();
  const inflight = useRef(new Set<string>());
  const m = useMutation({
    mutationFn: async (idea: Pick<Idea, 'id' | 'status'>) => {
      await api.updateIdea(idea.id, { status: 'in_progress', started_at: new Date().toISOString() });
      try {
        await api.requestLaunch('work_on_idea', { idea_id: idea.id, prev_status: idea.status });
      } catch (e) {
        await api.updateIdea(idea.id, { status: idea.status, started_at: null }); // nothing queued: undo the start
        throw e;
      }
    },
    onSettled: async (_d, _e, idea) => {
      try {
        await Promise.all([keys.ideas, keys.launchRequests].map((k) => qc.invalidateQueries({ queryKey: k })));
      } finally {
        setTimeout(() => inflight.current.delete(idea.id), 0);
      }
    },
  });
  const { mutate: run } = m;
  const mutate = (idea: Pick<Idea, 'id' | 'status'>) => {
    if (inflight.current.has(idea.id)) return;
    inflight.current.add(idea.id);
    run(idea);
  };
  return { ...m, mutate };
}

/** The Sheet's Status dropdown options, fetched once per screen visit. */
export const useSheetStatuses = () => {
  const api = useApi();
  return useQuery({
    queryKey: keys.sheetStatuses, queryFn: () => api.sheetStatuses(),
    refetchOnMount: 'always', refetchOnWindowFocus: false, retry: false,
  });
};

/** Writes Status to the Sheet. Optimistic on the applications list; reverts on error. */
export function useSetApplicationStatus() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { app: Application; status: string }) => api.setApplicationStatus(v.app, v.status),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.applications });
      const prev = qc.getQueryData<Application[]>(keys.applications);
      qc.setQueryData<Application[]>(keys.applications, (list) => list?.map((a) => (a.id === v.app.id ? { ...a, status: v.status } : a)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(keys.applications, ctx.prev); },
    // Also after errors: a client timeout can land after the Sheet write succeeded.
    onSettled: () => qc.invalidateQueries({ queryKey: keys.applications }),
  });
}

/** "I applied": appends to the Sheet. Resolves {duplicate: true} when the job is already there (nothing written). */
export const useMarkApplied = () =>
  useApiMutation((api, v: MarkAppliedInput) => api.markApplied(v), [keys.applications, keys.postings, keys.outreach]);
