import { AlreadyCountedError, type DataApi } from './api';
import { createFixtures } from './fixtures';
import { canRate } from './supabase';
import type { Idea, Outreach } from './types';

export { demoAuth } from './auth';

export function createDemoApi(now: Date = new Date()): DataApi {
  const db = createFixtures(now);
  const copy = <T>(x: T): Promise<T> => Promise.resolve(structuredClone(x));
  let seq = 1;
  const newId = (prefix: string) => `${prefix}-demo-${seq++}`;
  const stamp = () => new Date().toISOString();

  return {
    getSettings: () => copy(db.settings),
    async updateSettings(patch) { Object.assign(db.settings, patch); },
    getDailySet: (day) => copy(db.dailySet.day === day ? db.dailySet : null),
    listProblems: () => copy(db.problems),
    listTopics: () => copy(db.topics),
    listTopicStates: () => copy(db.topicStates),
    listProblemStates: () => copy(db.problemStates),
    listSolves: () => copy([...db.solves].sort((a, b) => Date.parse(b.accepted_at) - Date.parse(a.accepted_at))),
    async rateSolve(id, rating, at) {
      const s = db.solves.find((x) => x.id === id);
      if (!s) return;
      if (!canRate(s)) throw new AlreadyCountedError();
      Object.assign(s, { rating, rated_at: at.toISOString() });
    },
    listProjects: () => copy(db.projects),
    async addProject(p) { db.projects.push({ ...p, active: true }); },
    async setProjectActive(id, active) {
      const p = db.projects.find((x) => x.id === id);
      if (p) p.active = active;
    },
    listCommits: (since) => copy(db.commits.filter((c) => c.committed_at >= since)),
    listIdeas: () => copy([...db.ideas].sort((a, b) => a.position - b.position)),
    async addIdea(i) {
      const idea: Idea = { ...i, id: newId('idea'), status: 'todo', source: 'me', today_on: null, done_at: null, created_at: stamp() };
      db.ideas.push(idea);
    },
    async updateIdea(id, patch) {
      const i = db.ideas.find((x) => x.id === id);
      if (i) Object.assign(i, patch);
    },
    listApplications: () => copy(db.applications),
    listPostings: (since) => copy(db.postings.filter((p) => (p.status === 'new' || p.status === 'seen') && p.found_at >= since)),
    async setPostingStatus(id, status) {
      const p = db.postings.find((x) => x.id === id);
      if (p) p.status = status;
    },
    listOutreach: () => copy(db.outreach),
    listContacts: () => copy(db.contacts),
    async queueOutreach(i) {
      const o: Outreach = {
        id: newId('out'), job_url: i.job_url, company: i.company ?? null, role: i.role ?? null, resume_path: null,
        status: 'queued', sent_on: null, follow_up_on: null, created_at: stamp(),
      };
      db.outreach.unshift(o);
      db.launchRequests.unshift({ id: newId('req'), kind: 'outreach', payload: { outreach_id: o.id, job_url: o.job_url }, status: 'queued', error: null, created_at: o.created_at });
      return structuredClone(o);
    },
    async updateOutreach(id, patch) {
      const o = db.outreach.find((x) => x.id === id);
      if (o) Object.assign(o, patch);
    },
    async requestLaunch(kind, payload) {
      db.launchRequests.unshift({ id: newId('req'), kind, payload, status: 'queued', error: null, created_at: stamp() });
    },
    listLaunchRequests: () => copy(db.launchRequests),
    listSyncStatus: () => copy(db.syncStatus),
    syncLeetCode: async () => ({ status: 'skipped' }),
  };
}
