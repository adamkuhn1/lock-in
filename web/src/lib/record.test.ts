import { describe, expect, it } from 'vitest';
import type { Application } from '../data/types';
import type { DayActivity } from './activity';
import { seasonRecord } from './record';

const day = (d: string, active: boolean) => ({ day: d, active }) as DayActivity;
const app = (applied_on: string | null, stage: Application['stage'] = 'applied', status = 'Applied') =>
  ({ id: 1, company: 'X', role: null, track: null, term: null, location: null, status, stage, priority: null, applied_on }) as Application;

describe('seasonRecord', () => {
  it('finds the longest streak, best week and totals', () => {
    const days = [day('2026-10-01', true), day('2026-10-02', true), day('2026-10-03', false), day('2026-10-04', true), day('2026-10-05', true), day('2026-10-06', true)];
    const apps = [app('2026-10-05'), app('2026-10-06', 'interview'), app('2026-10-07', 'offer'), app('2026-09-29', 'closed', 'Rejected after interview'), app(null)];
    const r = seasonRecord(days, apps, [{ slug: 'two-sum' }, { slug: 'two-sum' }, { slug: 'lru-cache' }], [{ sent_on: '2026-10-01' }, { sent_on: null }]);
    expect(r).toEqual({
      longestStreak: 3, activeDays: 5, applications: 5, solved: 2, emails: 1, interviews: 3, offers: 1,
      bestWeek: { start: '2026-10-05', count: 3 },
    });
  });
  it('is all zeros with no data', () => {
    expect(seasonRecord([], [], [], [])).toEqual({ longestStreak: 0, activeDays: 0, applications: 0, solved: 0, emails: 0, interviews: 0, offers: 0, bestWeek: null });
  });
});
