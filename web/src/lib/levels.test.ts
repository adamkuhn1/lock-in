import { describe, expect, it } from 'vitest';
import type { Problem, ProblemState } from '../data/types';
import { reviewQueue, upcomingReviews } from './levels';

describe('levels', () => {
  const P = (slug: string, difficulty: Problem['difficulty'], topic = 'Stack'): Problem => ({
    slug, lc_id: null, title: slug, difficulty, topic, lists: [], paid_only: false, ac_rate: null, target_minutes: null, neetcode_link: null,
  });
  const problems = new Map([P('a', 'Easy'), P('b', 'Medium'), P('c', 'Hard')].map((p) => [p.slug, p]));
  const PS = (slug: string, due_on: string | null, state: ProblemState['state'] = 'reviewing'): ProblemState => ({ slug, state, interval_days: 3, due_on, lapses: 0 });
  it('reviewQueue: due today or overdue, oldest first, no retained', () => {
    const q = reviewQueue([PS('b', '2026-10-14'), PS('a', '2026-10-10'), PS('c', '2026-10-20'), PS('z', '2026-10-01', 'retained')], problems, '2026-10-14');
    expect(q.map((r) => r.state.slug)).toEqual(['a', 'b']);
    expect(q[0].problem?.difficulty).toBe('Easy');
  });
  it('upcomingReviews counts the next N days, excluding today', () => {
    expect(upcomingReviews([PS('b', '2026-10-14'), PS('c', '2026-10-20'), PS('d', '2026-10-22')], '2026-10-14', 7)).toBe(1);
  });
});
