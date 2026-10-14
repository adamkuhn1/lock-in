import { describe, expect, it } from 'vitest';
import type { DailySet, Problem, Solve } from '../data/types';
import { buildTodayItems } from './today';

const P = (slug: string, difficulty: Problem['difficulty'], topic: string): Problem => ({
  slug, lc_id: null, title: slug.replace(/-/g, ' '), difficulty, topic, lists: [], paid_only: false,
  ac_rate: null, target_minutes: null, neetcode_link: null,
});
const problems = new Map([
  P('two-sum', 'Easy', 'Arrays & Hashing'),
  P('best-time', 'Easy', 'Sliding Window'),
  P('daily-temperatures', 'Medium', 'Stack'),
  P('permutation-in-string', 'Medium', 'Sliding Window'),
].map((p) => [p.slug, p]));
const set: DailySet = {
  day: '2026-10-14', focus: 'Sliding Window', mixed_day: false,
  items: [
    { slug: 'best-time', slot: 'new', order: 1, done: false },
    { slug: 'two-sum', slot: 'review', order: 0, done: false },
    { slug: 'daily-temperatures', slot: 'mystery', order: 2, done: false },
    { slug: 'permutation-in-string', slot: 'new', order: 3, done: true },
  ],
};
let nextId = 1;
const S = (slug: string, at: string, rating: Solve['rating'] = null): Solve => ({
  id: nextId++, slug, title: slug, accepted_at: at, rating, rated_at: null, slot: null, note: null,
});

describe('buildTodayItems', () => {
  it('orders items and shows only off-focus topics', () => {
    const items = buildTodayItems(set, [], problems, '2026-10-14');
    expect(items.map((i) => i.slug)).toEqual(['two-sum', 'best-time', 'daily-temperatures', 'permutation-in-string']);
    expect(items[0].topicLabel).toBe('Arrays & Hashing'); // review from another topic
    expect(items[1].topicLabel).toBeNull(); // focus topic: implied by the card title
    expect(items[0].url).toBe('https://leetcode.com/problems/two-sum/');
  });
  it('hides a mystery topic until solved, then reveals it', () => {
    const before = buildTodayItems(set, [], problems, '2026-10-14')[2];
    expect(before.topicHidden).toBe(true);
    expect(before.topicLabel).toBeNull();
    const after = buildTodayItems(set, [S('daily-temperatures', '2026-10-14T15:00:00Z')], problems, '2026-10-14')[2];
    expect(after.topicHidden).toBe(false);
    expect(after.topicLabel).toBe('Stack');
  });
  it('hides every topic on a mixed day until solved', () => {
    const mixed = { ...set, mixed_day: true };
    const items = buildTodayItems(mixed, [S('two-sum', '2026-10-14T15:00:00Z')], problems, '2026-10-14');
    expect(items.filter((i) => i.topicHidden).map((i) => i.slug)).toEqual(['best-time', 'daily-temperatures', 'permutation-in-string']);
  });
  it('a fresh solve checks the item off before the worker does, and asks for a rating', () => {
    const it0 = buildTodayItems(set, [S('best-time', '2026-10-14T15:00:00Z')], problems, '2026-10-14')[1];
    expect(it0.done).toBe(true);
    expect(it0.needsRating).toBe(true);
  });
  it('counts a 1:30 AM solve toward the previous plan day', () => {
    const items = buildTodayItems(set, [S('best-time', '2026-10-15T05:30:00Z')], problems, '2026-10-14'); // 01:30 EDT Oct 15
    expect(items[1].done).toBe(true);
  });
  it('ignores a solve from another plan day', () => {
    const items = buildTodayItems(set, [S('best-time', '2026-10-13T15:00:00Z')], problems, '2026-10-14');
    expect(items[1].done).toBe(false);
  });
  it('worker done flag without a loaded solve: done, no rating prompt', () => {
    const it3 = buildTodayItems(set, [], problems, '2026-10-14')[3];
    expect(it3.done).toBe(true);
    expect(it3.needsRating).toBe(false);
  });
  it('rates the first solve and stops asking once any solve that day is rated', () => {
    const first = S('best-time', '2026-10-14T13:00:00Z');
    const second = S('best-time', '2026-10-14T14:00:00+00:00');
    const unrated = buildTodayItems(set, [second, first], problems, '2026-10-14')[1];
    expect(unrated.solve?.id).toBe(first.id);
    const ratedSecond = { ...second, rating: 'nailed' as const };
    const done = buildTodayItems(set, [ratedSecond, first], problems, '2026-10-14')[1];
    expect(done.needsRating).toBe(false);
    expect(done.solve?.rating).toBe('nailed');
  });
  it('falls back to the slug when a problem is unknown', () => {
    const odd = { ...set, items: [{ slug: 'not-in-bank', slot: 'new' as const, order: 0, done: false }] };
    expect(buildTodayItems(odd, [], problems, '2026-10-14')[0].title).toBe('not in bank');
  });
});
