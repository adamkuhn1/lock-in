import { describe, expect, it } from 'vitest';
import type { LearnCheck, LearnProgress } from '../data/types';
import { lessonReviewsDue, pickQuestions, reviewRating } from './lessonReview';
import type { Lesson, Question } from './lessons';

const L = (n: number): Lesson => ({ id: `cs-1/0${n}-x`, moduleId: 'cs-1', slug: `0${n}-x`, ord: n, title: `L${n}`, minutes: 10 });
const done = (n: number, on: string): LearnProgress =>
  ({ item_id: `lesson:cs-1/0${n}-x`, status: 'done', rating: 'nailed', notes: '', started_on: on, done_on: on });
const review = (n: number, on: string, rating: LearnCheck['rating']): LearnCheck =>
  ({ id: `${n}${on}`, module_id: `lesson:cs-1/0${n}-x`, kind: 'review', score: 2, total: 2, rating, summary: '', taken_on: on });

describe('lesson reviews', () => {
  const lessons = [L(1), L(2), L(3)];
  it('a finished lesson is due 3 days later, then 7 after a nailed review', () => {
    const progress = [done(1, '2026-10-01'), done(2, '2026-10-05'), { ...done(3, '2026-10-01'), status: 'in_progress' as const }];
    expect(lessonReviewsDue(progress, [], '2026-10-03', lessons)).toEqual([]);
    expect(lessonReviewsDue(progress, [], '2026-10-04', lessons).map((d) => [d.lesson.ord, d.due, d.reviewsSoFar])).toEqual([[1, '2026-10-04', 0]]);
    expect(lessonReviewsDue(progress, [], '2026-10-08', lessons).map((d) => d.lesson.ord)).toEqual([1, 2]);
    const checks = [review(1, '2026-10-04', 'nailed')];
    expect(lessonReviewsDue(progress, checks, '2026-10-10', lessons).map((d) => d.lesson.ord)).toEqual([2]);
    expect(lessonReviewsDue(progress, checks, '2026-10-11', lessons).map((d) => [d.lesson.ord, d.reviewsSoFar])).toEqual([[2, 0], [1, 1]]);
  });
  it('module checks and other lessons do not count', () => {
    const checks: LearnCheck[] = [{ ...review(1, '2026-10-04', 'nailed'), module_id: 'cs-1' }];
    expect(lessonReviewsDue([done(1, '2026-10-01')], checks, '2026-10-04', lessons)).toHaveLength(1);
  });
  it('rotates through the questions and scores like Claude checks', () => {
    const qs = ['a', 'b', 'c'].map((q): Question => ({ q, answer: [q], why: '' }));
    expect([0, 1, 2].map((r) => pickQuestions(qs, r).map((q) => q.q).join(''))).toEqual(['ab', 'ca', 'bc']);
    expect(pickQuestions(qs.slice(0, 1), 4)).toHaveLength(1);
    expect([reviewRating(2, 2), reviewRating(1, 2), reviewRating(0, 2), reviewRating(4, 5)]).toEqual(['nailed', 'struggled', 'help', 'nailed']);
  });
});
