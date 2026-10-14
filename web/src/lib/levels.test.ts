import { describe, expect, it } from 'vitest';
import type { Problem, ProblemState, Solve, Topic } from '../data/types';
import { reviewQueue, roadmapRows, topicCounts, upcomingReviews } from './levels';

const T = (name: string, tier: number, ord: number, prereqs: string[] = []): Topic => ({ name, tier, ord, prereqs, lc_tags: [] });
const topics = [T('Two Pointers', 1, 2, ['Arrays & Hashing']), T('Arrays & Hashing', 0, 1), T('Stack', 1, 3, ['Arrays & Hashing'])];

describe('levels', () => {
  it('roadmapRows groups by tier in roadmap order and marks focus', () => {
    const rows = roadmapRows(topics, [{ topic: 'Arrays & Hashing', level: 'solid' }], 'Two Pointers');
    expect(rows.map((r) => [r.tier, r.topics.map((t) => t.name)])).toEqual([[0, ['Arrays & Hashing']], [1, ['Two Pointers', 'Stack']]]);
    expect(rows[1].topics[0]).toMatchObject({ level: 'locked', isFocus: true });
  });
  it('roadmapRows defaults: no state → available without prereqs, locked with', () => {
    const rows = roadmapRows(topics, [], null);
    expect(rows[0].topics[0].level).toBe('available');
    expect(rows[1].topics[1].level).toBe('locked');
  });
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
  it('topicCounts counts distinct solved problems by difficulty', () => {
    const solves = [{ slug: 'a' }, { slug: 'a' }, { slug: 'b' }, { slug: 'not-in-bank' }] as Solve[];
    expect(topicCounts(solves, problems, 'Stack')).toEqual({ Easy: 1, Medium: 1, Hard: 0 });
  });
});
