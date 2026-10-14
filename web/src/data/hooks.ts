import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DataApi } from './api';
import { useApi } from './context';
import type { IdeaPatch, LaunchKind, NewIdea, NewProject, OutreachPatch, PostingStatus, Problem, Rating, SettingsPatch, Solve } from './types';

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

function useApiMutation<V>(fn: (api: DataApi, v: V) => Promise<unknown>, invalidate: QueryKey[]) {
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
