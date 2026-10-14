import { describe, expect, it } from 'vitest';
import type { Application, Commit, Solve } from '../data/types';
import { dayNumber, streak, streaks } from './streaks';

describe('streaks', () => {
  it('counts back from today, or from yesterday if today is not done yet', () => {
    expect(streak(new Set(['2026-10-14', '2026-10-13', '2026-10-12']), '2026-10-14')).toBe(3);
    expect(streak(new Set(['2026-10-13', '2026-10-12']), '2026-10-14')).toBe(2);
    expect(streak(new Set(['2026-10-12']), '2026-10-14')).toBe(0);
    expect(streak(new Set(), '2026-10-14')).toBe(0);
  });
  it('uses the Detroit calendar day of each event', () => {
    const solve = { accepted_at: '2026-10-15T03:50:00Z' } as Solve; // 23:50 EDT Oct 14
    const commit = { committed_at: '2026-10-14T18:00:00Z' } as Commit;
    const app = { applied_on: '2026-10-13' } as Application;
    expect(streaks([solve], [commit], [app], new Date('2026-10-15T12:00:00Z'))).toEqual({ leetcode: 1, project: 1, apps: 0 });
  });
  it('dayNumber', () => {
    expect(dayNumber('2026-10-03', '2026-10-14')).toBe(12);
    expect(dayNumber(null, '2026-10-14')).toBeNull();
  });
});
