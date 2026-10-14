import { describe, expect, it } from 'vitest';
import type { Application, CompanyPrep, PrepSession, Story } from '../data/types';
import { missingTags, nextStatus, practicedLabel, prepCompanies, weekSessions } from './prep';

const app = (company: string, stage: Application['stage']): Application =>
  ({ id: 1, company, role: null, track: null, term: null, location: null, status: null, stage, priority: null, applied_on: null });
const cp = (company: string, interview_on: string | null): CompanyPrep => ({ id: company, company, notes: '', links: '', interview_on, created_at: '' });
const T = '2026-10-14';

describe('prep', () => {
  it('lists OA/interview/offer companies plus saved prep, interviews within 14 days first', () => {
    const list = prepCompanies(
      [app('Stripe', 'oa'), app('stripe ', 'interview'), app('Ramp', 'applied'), app('Palantir', 'interview')],
      [cp('Datadog', '2026-10-17'), cp('Palantir', '2026-11-30')], T);
    expect(list.map((c) => [c.company, c.days])).toEqual([['Datadog', 3], ['Palantir', 47], ['Stripe', null]]);
    expect(list.find((c) => c.company === 'Stripe')!.prep).toBeNull();
  });

  it('missing tags', () => {
    const s = (tags: Story['tags']): Story => ({ id: 'x', title: 'x', tags, situation: '', task: '', action: '', result: '', last_practiced_on: null, created_at: '' });
    expect(missingTags([s(['impact', 'leadership']), s(['conflict'])])).toEqual(['failure', 'teamwork']);
  });

  it('practiced label', () => {
    expect(practicedLabel(null, T)).toBe('never');
    expect(practicedLabel(T, T)).toBe('today');
    expect(practicedLabel('2026-10-13', T)).toBe('yesterday');
    expect(practicedLabel('2026-10-04', T)).toBe('10 days ago');
  });

  it('checklist status cycles', () => {
    expect(nextStatus(null)).toBe('learning');
    expect(nextStatus('learning')).toBe('solid');
    expect(nextStatus('solid')).toBeNull();
  });

  it('this week sessions (Mon..today)', () => {
    const ps = (happened_on: string): PrepSession => ({ id: happened_on, kind: 'oa', minutes: null, note: null, company: null, story_id: null, happened_on, created_at: '' });
    expect(weekSessions([ps('2026-10-11'), ps('2026-10-12'), ps(T)], T).map((s) => s.happened_on)).toEqual(['2026-10-12', T]);
  });
});
