import { describe, expect, it } from 'vitest';
import type { Solve } from '../data/types';
import { heatmap, intensity } from './heatmap';

describe('heatmap', () => {
  it('weeks start Monday, end with the current week, and mark the future', () => {
    const solves = [{ accepted_at: '2026-10-14T15:00:00Z' }, { accepted_at: '2026-10-14T16:00:00Z' }, { accepted_at: '2026-10-05T15:00:00Z' }] as Solve[];
    const weeks = heatmap(solves, '2026-10-14', 2);
    expect(weeks.length).toBe(2);
    expect(weeks[0][0].day).toBe('2026-10-05');
    expect(weeks[0][0].count).toBe(1);
    expect(weeks[1][2]).toEqual({ day: '2026-10-14', count: 2, future: false });
    expect(weeks[1][3].future).toBe(true);
  });
  it('intensity buckets', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(intensity)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});
