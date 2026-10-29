import { AlreadyCountedError, type DataApi } from './api';
import { createFixtures } from './fixtures';
import { canRate } from './supabase';
import { statusStage } from '../lib/stages';
import { localDay } from '../lib/time';
import { KEPT, type Idea, type LaunchKind, type Outreach, type Tier } from './types';

/** Stand-in for the Sheet's Status dropdown in demo mode. */
export const DEMO_STATUSES = [
  'Not applied yet', 'Applied', 'Submitted', 'OA invited', 'OA - HackerRank', 'Interview - R1', 'Final round', 'Offer received',
  'Rejected', 'Rejected after OA', 'Rejected after interview', 'No response',
];

export { demoAuth } from './auth';

export function createDemoApi(now: Date = new Date()): DataApi {
  const db = createFixtures(now);
  const copy = <T>(x: T): Promise<T> => Promise.resolve(structuredClone(x));
  let seq = 1;
  const newId = (prefix: string) => `${prefix}-demo-${seq++}`;
  const stamp = () => new Date().toISOString();
  const queueWith = async (kind: LaunchKind, i: { job_url: string; company?: string | null; role?: string | null; fill?: boolean; tier?: Tier | null }) => {
    const o: Outreach = {
      id: newId('out'), job_url: i.job_url, company: i.company ?? null, role: i.role ?? null, resume_path: null,
      status: 'queued', sent_on: null, follow_up_on: null, followups: 0, created_at: stamp(), tier: i.tier ?? null, replied_on: null,
    };
    db.outreach.unshift(o);
    db.launchRequests.unshift({ id: newId('req'), kind, payload: { outreach_id: o.id, job_url: o.job_url, ...(i.fill ? { fill_application: true } : {}) }, status: 'queued', error: null, created_at: o.created_at });
    return structuredClone(o);
  };

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
    listPostings: (since) => copy(db.postings.filter((p) => (p.status === 'new' || p.status === 'seen' || p.status === 'filtered') && p.found_at >= since)),
    async restorePosting(id) {
      const p = db.postings.find((x) => x.id === id);
      if (p) Object.assign(p, { status: 'new', filtered_reason: KEPT });
    },
    async setPostingStatus(id, status) {
      const p = db.postings.find((x) => x.id === id);
      if (p) p.status = status;
    },
    listOutreach: () => copy(db.outreach),
    listContacts: () => copy(db.contacts),
    queueOutreach: (i) => queueWith('outreach', i),
    queueTailor: (i) => queueWith('tailor_resume', i),
    async updateOutreach(id, patch) {
      const o = db.outreach.find((x) => x.id === id);
      if (o) Object.assign(o, patch);
    },
    listReferrals: () => copy([...db.referrals].sort((a, b) => a.created_at.localeCompare(b.created_at))),
    async updateReferral(id, patch) {
      const r = db.referrals.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    async findEngineers(i) {
      db.launchRequests.unshift({
        id: newId('req'), kind: 'find_engineers', status: 'queued', error: null, created_at: stamp(),
        payload: { company: i.company, role: i.role ?? null, tier: i.tier ?? null, ...(i.posting_id ? { posting_id: i.posting_id } : {}), ...(i.job_url ? { job_url: i.job_url } : {}) },
      });
    },
    async requestLaunch(kind, payload) {
      db.launchRequests.unshift({ id: newId('req'), kind, payload, status: 'queued', error: null, created_at: stamp() });
    },
    listLaunchRequests: () => copy(db.launchRequests),
    listSyncStatus: () => copy(db.syncStatus),
    syncLeetCode: async () => ({ status: 'skipped' }),
    sheetStatuses: () => copy(DEMO_STATUSES),
    async setApplicationStatus(app, status) {
      const a = db.applications.find((x) => x.id === app.id);
      if (!a) throw new Error("Couldn't find that row in your Sheet; it may have moved. Refresh and try again.");
      if (!DEMO_STATUSES.includes(status)) throw new Error("That status isn't in your Sheet's Status dropdown. Add it there first.");
      Object.assign(a, { status, stage: statusStage(status) });
    },
    async markApplied({ posting_id, outreach_id, force }) {
      const p = posting_id ? db.postings.find((x) => x.id === posting_id) : undefined;
      const o = outreach_id ? db.outreach.find((x) => x.id === outreach_id) : undefined;
      const company = p?.company ?? o?.company;
      const role = p?.title ?? o?.role ?? null;
      if (!company) throw new Error("Couldn't find that job.");
      const key = (s: string | null) => (s ?? '').trim().toLowerCase();
      if (!force && db.applications.some((a) => key(a.company) === key(company) && key(a.role) === key(role))) return { duplicate: true };
      db.applications.push({
        id: Math.max(0, ...db.applications.map((a) => a.id)) + 1, company, role, track: null, term: p?.term ?? null,
        location: p?.location ?? null, status: 'Applied', stage: 'applied', priority: 'Unranked', applied_on: localDay(new Date()), sheet_row: null,
      });
      if (p) p.status = 'applied';
      return {};
    },
    async undoApplied({ company, role }) {
      const key = (s: string | null) => (s ?? '').trim().toLowerCase();
      const today = localDay(new Date());
      const hit = db.applications.find((a) => key(a.company) === key(company) && key(a.role) === key(role) && a.applied_on === today && a.stage === 'applied');
      if (!hit) throw new Error('Only an application added today and still marked Applied can be undone here. Edit the Sheet directly.');
      db.applications = db.applications.filter((a) => a !== hit);
      for (const p of db.postings) if (p.status === 'applied' && key(p.company) === key(company) && key(p.title) === key(role)) p.status = 'seen';
    },
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
