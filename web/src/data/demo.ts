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
      const idea: Idea = { ...i, id: newId('idea'), status: 'todo', source: 'me', today_on: null, done_at: null, started_at: null, created_at: stamp() };
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
    async updateProject(id, patch) { const p = db.projects.find((x) => x.id === id); if (p) Object.assign(p, patch); },
    listStories: () => copy([...db.stories].sort((a, b) => a.created_at.localeCompare(b.created_at))),
    async addStory(s) { db.stories.push({ ...s, id: newId('story'), last_practiced_on: null, created_at: stamp() }); },
    async updateStory(id, patch) { const s = db.stories.find((x) => x.id === id); if (s) Object.assign(s, patch); },
    async deleteStory(id) { db.stories = db.stories.filter((x) => x.id !== id); },
    listPrepSessions: (since) => copy(db.prepSessions.filter((s) => s.happened_on >= since).sort((a, b) => b.happened_on.localeCompare(a.happened_on))),
    async addPrepSession(s) {
      db.prepSessions.unshift({ id: newId('ps'), minutes: null, note: null, company: null, story_id: null, ...s, created_at: stamp() });
    },
    listPrepItems: () => copy(db.prepItems),
    listPrepProgress: () => copy(db.prepProgress),
    async setPrepProgress(itemId, status) {
      db.prepProgress = db.prepProgress.filter((p) => p.item_id !== itemId);
      if (status) db.prepProgress.push({ item_id: itemId, status });
    },
    listCompanyPrep: () => copy([...db.companyPrep].sort((a, b) => a.company.localeCompare(b.company))),
    async saveCompanyPrep(p) {
      const hit = db.companyPrep.find((x) => x.company === p.company);
      if (hit) Object.assign(hit, p);
      else db.companyPrep.push({ ...p, id: newId('cp'), created_at: stamp() });
    },
    listEvents: () => copy([...db.events].sort((a, b) => a.on_date.localeCompare(b.on_date))),
    async addEvent(e) { db.events.push({ at_time: null, company: null, url: null, ...e, id: newId('ev'), created_at: stamp() }); },
    async deleteEvent(id) { db.events = db.events.filter((x) => x.id !== id); },
  };
}
