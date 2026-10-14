import { describe, expect, it } from 'vitest';
import { activeStreak, dayActivity, dayLine, dayN, heatmapWeeks } from './activity';

const none = { solves: [], applications: [], outreach: [], commits: [], prep: [] };

describe('activity', () => {
  it('Day N counts day_one as Day 1 and is 0 before it', () => {
    expect(dayN('2026-09-28', '2026-10-14')).toBe(17);
    expect(dayN('2026-09-28', '2026-09-28')).toBe(1);
    expect(dayN('2026-10-20', '2026-10-14')).toBe(0);
  });

  it('a future day_one gives no days, streak 0, no weeks', () => {
    const days = dayActivity(none, '2026-10-20', '2026-10-14');
    expect(days).toEqual([]);
    expect(activeStreak(days, '2026-10-14')).toBe(0);
    expect(heatmapWeeks(days)).toEqual([]);
  });

  it('maps timestamps to plan days (4 AM ET) and counts kinds', () => {
    const days = dayActivity({
      solves: [{ accepted_at: '2026-10-14T07:59:00Z' }, { accepted_at: '2026-10-14T08:00:00Z' }], // 03:59 EDT -> 13th; 04:00 -> 14th
      applications: [{ applied_on: '2026-10-14' }, { applied_on: null }],
      outreach: [{ sent_on: '2026-10-14' }, { sent_on: null }],
      commits: [{ committed_at: '2026-10-14T20:00:00Z' }],
      prep: [{ happened_on: '2026-10-14' }],
    }, '2026-10-12', '2026-10-14');
    expect(days.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(days[1]).toMatchObject({ solves: 1, kinds: 1, intensity: 1, active: true });
    expect(days[2]).toMatchObject({ solves: 1, applications: 1, outreach: 1, commits: 1, prep: 1, kinds: 5, intensity: 4, active: true });
    expect(days[0]).toMatchObject({ kinds: 0, intensity: 0, active: false });
  });

  it('handles the November DST change (01:30 EST counts for the previous day)', () => {
    const days = dayActivity({ ...none, solves: [{ accepted_at: '2026-11-02T06:30:00Z' }] }, '2026-11-01', '2026-11-02');
    expect(days[0].solves).toBe(1);
    expect(days[1].solves).toBe(0);
  });

  it('streak keeps yesterday when today is still empty, and breaks on a gap', () => {
    const days = dayActivity({ ...none, prep: [{ happened_on: '2026-10-12' }, { happened_on: '2026-10-13' }] }, '2026-10-10', '2026-10-14');
    expect(activeStreak(days, '2026-10-14')).toBe(2);
    const gap = dayActivity({ ...none, prep: [{ happened_on: '2026-10-11' }, { happened_on: '2026-10-13' }] }, '2026-10-10', '2026-10-14');
    expect(activeStreak(gap, '2026-10-14')).toBe(1);
  });

  it('heatmap weeks are Mon–Sun columns with blanks outside the range', () => {
    const days = dayActivity(none, '2026-10-14', '2026-10-20'); // Wed .. Tue
    const weeks = heatmapWeeks(days);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].map((c) => c?.day ?? null)).toEqual([null, null, '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(weeks[1].map((c) => c?.day ?? null)).toEqual(['2026-10-19', '2026-10-20', null, null, null, null, null]);
  });

  it('dayLine formats like TUE 10/14 in Eastern time', () => {
    expect(dayLine(new Date('2026-10-14T16:00:00Z'))).toBe('WED 10/14');
    expect(dayLine(new Date('2026-10-15T02:00:00Z'))).toBe('WED 10/14');
  });
});
