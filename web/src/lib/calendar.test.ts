import { describe, expect, it } from 'vitest';
import type { CalEvent, CompanyPrep, Outreach } from '../data/types';
import { addMonths, calendarItems, countdown, dotKind, groupByWeek, monthGrid, upcoming, weekFocus } from './calendar';

const ev = (p: Partial<CalEvent>): CalEvent => ({ id: 'e', title: 't', kind: 'other', on_date: '2026-10-14', at_time: null, company: null, url: null, created_at: '', ...p });
const prep = (p: Partial<CompanyPrep>): CompanyPrep => ({ id: 'c', company: 'Figma', notes: '', links: '', interview_on: null, created_at: '', ...p });
const out = (p: Partial<Outreach>): Outreach => ({ id: 'o', job_url: '', company: 'Ramp', role: null, resume_path: null, status: 'sent', sent_on: null, follow_up_on: null, followups: 0, created_at: '', ...p });
const T = '2026-10-14'; // Wednesday

describe('calendar', () => {
  it('merges events, interview dates and sent follow-ups, sorted by date then time', () => {
    const items = calendarItems(
      [ev({ id: 'a', title: 'Stripe OA', kind: 'oa', on_date: '2026-10-15', at_time: '15:00:00' }), ev({ id: 'b', title: 'Fair', on_date: '2026-10-15', at_time: '09:00:00' })],
      [prep({ company: 'Figma', interview_on: '2026-10-16' }), prep({ company: 'NoDate' })],
      [out({ follow_up_on: '2026-10-14' }), out({ status: 'drafted', follow_up_on: '2026-10-14' })],
    );
    expect(items.map((i) => i.title)).toEqual(['Follow up: Ramp', 'Fair', 'Stripe OA', 'Figma interview']);
    expect(items[3]).toMatchObject({ kind: 'interview', eventId: null, company: 'Figma' });
    expect(items[1].eventId).toBe('b');
  });

  it('upcoming drops past items', () => {
    const items = calendarItems([ev({ on_date: '2026-10-13' }), ev({ id: 'x', on_date: T })], [], []);
    expect(upcoming(items, T).map((i) => i.on_date)).toEqual([T]);
  });

  it('groups by Monday weeks with friendly labels', () => {
    const items = calendarItems([ev({ id: '1', on_date: T }), ev({ id: '2', on_date: '2026-10-19' }), ev({ id: '3', on_date: '2026-11-03' })], [], []);
    expect(groupByWeek(items, T).map((g) => [g.label, g.items.length])).toEqual([['This week', 1], ['Next week', 1], ['Week of Nov 2', 1]]);
  });

  it('countdown text', () => {
    expect(countdown(T, T)).toBe('today');
    expect(countdown('2026-10-15', T)).toBe('tomorrow');
    expect(countdown('2026-10-20', T)).toBe('in 6 days');
    expect(countdown('2026-10-12', T)).toBe('2 days ago');
  });

  it('month grid is Mon–Sun weeks with nulls outside the month', () => {
    const g = monthGrid('2026-10');
    expect(g[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(g[g.length - 1].filter(Boolean).pop()).toBe('2026-10-31');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('dot kind prefers interview > oa > deadline > app_open > other', () => {
    const items = calendarItems([ev({ id: '1', kind: 'deadline' }), ev({ id: '2', kind: 'oa' })], [], []);
    expect(dotKind(items)).toBe('oa');
  });

  it('week focus: interview, then OA, then deadline, else volume', () => {
    const iv = calendarItems([], [prep({ interview_on: '2026-10-16' })], []);
    expect(weekFocus(iv, T, 25)).toEqual({ text: 'Interview in 2 days: mock + company notes', to: '/grind/prep' });
    const oa = calendarItems([ev({ kind: 'oa', on_date: T })], [], []);
    expect(weekFocus(oa, T, 25)).toEqual({ text: 'OA today: daily OA practice', to: '/grind/prep' });
    const dl = calendarItems([ev({ kind: 'deadline', title: 'Ramp app', on_date: '2026-10-15' })], [], []);
    expect(weekFocus(dl, T, 25)).toEqual({ text: 'Deadline tomorrow: Ramp app', to: null });
    const far = calendarItems([ev({ kind: 'interview', on_date: '2026-10-30' })], [], []);
    expect(weekFocus(far, T, 25)).toEqual({ text: 'Volume week: hit 25 applications', to: '/hunt/jobs' });
  });
});
