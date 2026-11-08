import { describe, expect, it } from 'vitest';
import cases from '../../../shared/mastery_cases.json';
import type { LcRating, Level, Problem, Slot, Solve } from '../data/types';
import { type Attempt, attemptsByTopic, levelFrom, masteryShare, nextStep, progress } from './mastery';

const toAttempts = (c: (typeof cases.cases)[number]): Attempt[] =>
  c.attempts.map((a) => ({ ...a, difficulty: a.difficulty as Attempt['difficulty'], rating: a.rating as LcRating, slot: a.slot as Slot }));

describe('mastery: shared cases (same as the worker)', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const attempts = toAttempts(c);
      const p = progress(attempts, c.pools);
      expect(levelFrom(p, c.pools, attempts.length > 0, c.prereqs as Level[])).toBe(c.expect.level);
      expect([p.easyCleared, p.firstTries, p.mediumSolo, p.hardsTried])
        .toEqual([c.expect.easyCleared, c.expect.firstTries, c.expect.mediumSolo, c.expect.hardsTried]);
    });
  }
});

const PROBLEMS = new Map<string, Problem>([
  ['m', { slug: 'm', lc_id: 1, title: 'M', difficulty: 'Medium', topic: 'T', lists: [], paid_only: false, ac_rate: 50, target_minutes: null, neetcode_link: null }],
]);
const solve = (over: Partial<Solve>): Solve => ({
  id: 1, slug: 'm', title: 'M', accepted_at: '2026-11-02T18:00:00Z', rating: null, rated_at: null, applied_at: null, slot: null, note: null, ...over,
});

describe('attemptsByTopic', () => {
  it('counts the worker rating, a fresh rating, and skips a pending unrated solve', () => {
    const got = attemptsByTopic([
      solve({ id: 1, effective_rating: 'explained', applied_at: 'x' }),
      solve({ id: 2, accepted_at: '2026-11-04T18:00:00Z', rating: 'solo' }),
      solve({ id: 3, accepted_at: '2026-11-06T18:00:00Z' }),
    ], PROBLEMS).get('T')!;
    expect(got.map((a) => [a.on, a.rating])).toEqual([['2026-11-02', 'explained'], ['2026-11-04', 'solo']]);
  });
  it('two solves on one day are one attempt', () => {
    const got = attemptsByTopic([
      solve({ id: 1, rating: 'codealong' }), solve({ id: 2, accepted_at: '2026-11-02T19:00:00Z', rating: 'solo' }),
    ], PROBLEMS).get('T')!;
    expect(got).toHaveLength(1);
    expect(got[0].rating).toBe('codealong');
  });
});

describe('nextStep', () => {
  const pools = { easy: 19, medium: 19, hard: 4 };
  it('practicing → solid lists the Easy and new-Medium bars', () => {
    const p = progress([], pools);
    const s = nextStep('practicing', { ...p, easyCleared: 9, firstTries: ['solo', 'solo', 'codealong'] }, pools);
    expect(s.target).toBe('solid');
    expect(s.reqs.map((r) => [r.text, r.have, r.need, r.met])).toEqual([
      ['Clear 10 Easies', 9, 10, false],
      ['Solve 3 of your last 5 new Mediums on your own', 2, 3, false],
    ]);
  });
  it('a topic with no Easies or Hards drops those rows', () => {
    const s = nextStep('solid', progress([], { easy: 0, medium: 10, hard: 0 }), { easy: 0, medium: 10, hard: 0 });
    expect(s.reqs.map((r) => r.kind)).toEqual(['window']);
  });
  it('masteryShare is 1 only when mastered', () => {
    const p = { easyCleared: 19, easyTotal: 19, firstTries: ['solo', 'solo', 'solo', 'solo', 'solo'] as LcRating[], mediumSolo: 5, hardsTried: 2, hardTotal: 4 };
    expect(masteryShare('solid', p, pools)).toBeLessThan(1);
    expect(masteryShare('mastered', p, pools)).toBe(1);
  });
});
