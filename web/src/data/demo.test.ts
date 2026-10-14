import { describe, expect, it } from 'vitest';
import { planDay } from '../lib/time';
import { AlreadyCountedError } from './api';
import { createDemoApi } from './demo';

const NOW = new Date('2026-10-14T16:00:00Z'); // 12:00 EDT

describe('demo api', () => {
  it("has today's 6-item Sliding Window set", async () => {
    const api = createDemoApi(NOW);
    const set = await api.getDailySet(planDay(NOW));
    expect(set?.focus).toBe('Sliding Window');
    expect(set?.items).toHaveLength(6);
    expect(await api.getDailySet('2020-01-01')).toBeNull();
  });
  it('fixture sizes match the brief', async () => {
    const api = createDemoApi(NOW);
    expect(await api.listApplications()).toHaveLength(20);
    expect(await api.listPostings('2000-01-01T00:00:00Z')).toHaveLength(8);
    expect(await api.listOutreach()).toHaveLength(4);
    expect((await api.listProjects()).map((p) => p.id)).toEqual(['27b', 'showboat', 'lego']);
    expect(await api.listTopics()).toHaveLength(18);
  });
  it('returns copies, so callers cannot mutate the store', async () => {
    const api = createDemoApi(NOW);
    (await api.listIdeas())[0].text = 'changed';
    expect((await api.listIdeas())[0].text).not.toBe('changed');
  });
  it('rateSolve sets rating and rated_at', async () => {
    const api = createDemoApi(NOW);
    const unrated = (await api.listSolves()).find((s) => s.rating === null && s.applied_at === null)!;
    await api.rateSolve(unrated.id, 'struggled', NOW);
    const after = (await api.listSolves()).find((s) => s.id === unrated.id)!;
    expect([after.rating, after.rated_at]).toEqual(['struggled', NOW.toISOString()]);
  });
  it('rateSolve rejects an already-applied solve', async () => {
    const api = createDemoApi(NOW);
    const late = (await api.listSolves()).find((s) => s.rating === null && s.applied_at !== null)!;
    await expect(api.rateSolve(late.id, 'nailed', NOW)).rejects.toBeInstanceOf(AlreadyCountedError);
  });
  it('queueOutreach creates a queued outreach and a launch request', async () => {
    const api = createDemoApi(NOW);
    const o = await api.queueOutreach({ job_url: 'https://jobs.lever.co/acme/1' });
    expect(o.status).toBe('queued');
    const req = (await api.listLaunchRequests()).find((r) => r.payload.outreach_id === o.id)!;
    expect(req).toMatchObject({ kind: 'outreach', status: 'queued', payload: { outreach_id: o.id, job_url: 'https://jobs.lever.co/acme/1' } });
  });
  it('updates ideas, postings, outreach, settings and projects', async () => {
    const api = createDemoApi(NOW);
    await api.addIdea({ project_id: '27b', text: 'New thing', size: 'M', position: 9 });
    const idea = (await api.listIdeas()).find((i) => i.text === 'New thing')!;
    expect(idea).toMatchObject({ status: 'todo', source: 'me', size: 'M', position: 9 });
    await api.updateIdea(idea.id, { status: 'done' });
    expect((await api.listIdeas()).find((i) => i.id === idea.id)!.status).toBe('done');
    const p = (await api.listPostings('2000-01-01T00:00:00Z'))[0];
    await api.setPostingStatus(p.id, 'dismissed');
    expect((await api.listPostings('2000-01-01T00:00:00Z')).some((x) => x.id === p.id)).toBe(false);
    const o = (await api.listOutreach())[0];
    await api.updateOutreach(o.id, { status: 'sent', sent_on: '2026-10-14', follow_up_on: '2026-10-19' });
    expect((await api.listOutreach()).find((x) => x.id === o.id)!.follow_up_on).toBe('2026-10-19');
    await api.updateSettings({ daily_lc_count: 7 });
    expect((await api.getSettings()).daily_lc_count).toBe(7);
    await api.addProject({ id: 'lego', name: 'LEGO', repo: 'adamkuhn1/lego', local_path: '~/Developer/lego' });
    await api.setProjectActive('lego', false);
    expect((await api.listProjects()).find((x) => x.id === 'lego')!.active).toBe(false);
  });
  it('listPostings honors the since cutoff', async () => {
    const api = createDemoApi(NOW);
    expect(await api.listPostings('2030-01-01T00:00:00Z')).toEqual([]);
  });
  it('sync is a no-op in demo mode', async () => {
    expect(await createDemoApi(NOW).syncLeetCode()).toEqual({ status: 'skipped' });
  });
});

describe('demo v2 data', () => {
  it('round-trips prep, events and company prep', async () => {
    const api = createDemoApi(new Date('2026-10-14T16:00:00Z'));
    await api.addPrepSession({ kind: 'study', happened_on: '2026-10-14', minutes: 20 });
    expect((await api.listPrepSessions('2026-10-14'))[0]).toMatchObject({ kind: 'study', minutes: 20, note: null });
    await api.setPrepProgress('cs-http', null);
    expect((await api.listPrepProgress()).some((p) => p.item_id === 'cs-http')).toBe(false);
    await api.saveCompanyPrep({ company: 'Stripe', notes: 'x', links: '', interview_on: null });
    await api.saveCompanyPrep({ company: 'Stripe', notes: 'y', links: '', interview_on: null });
    expect((await api.listCompanyPrep()).filter((c) => c.company === 'Stripe')).toHaveLength(1);
    await api.addEvent({ title: 'T', kind: 'other', on_date: '2026-10-20' });
    const ev = (await api.listEvents()).find((x) => x.title === 'T')!;
    await api.deleteEvent(ev.id);
    expect((await api.listEvents()).some((x) => x.title === 'T')).toBe(false);
    expect((await api.listProjects()).find((p) => p.id === 'lego')!.repo).toBeNull();
    expect(await api.listPrepItems()).toHaveLength(30);
  });
});
