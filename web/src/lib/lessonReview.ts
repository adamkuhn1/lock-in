/**
 * Spaced review of finished lessons, in the app: a few recall questions from each lesson that's due. A lesson comes
 * back 3, 7, 21, 60 and 120 days after you finish it (nextReview: nailed moves a step out, struggled repeats, needed
 * help starts over). Each lesson's result is a learn_checks row with module_id "lesson:<id>", so it also counts for
 * the day.
 */
import type { LearnCheck, LearnProgress, Rating } from '../data/types';
import { nextReview } from './learn';
import { LESSONS, lessonItemId, type Lesson, type Question } from './lessons';

export const REVIEW_LESSONS_MAX = 5;
export const QUESTIONS_PER_LESSON = 2;
/** About how long one review question takes, for "about N min". */
export const SECONDS_PER_QUESTION = 40;

export interface DueLesson { lesson: Lesson; due: string; reviewsSoFar: number }

export function lessonReviewsDue(progress: LearnProgress[], checks: LearnCheck[], today: string, lessons: Lesson[] = LESSONS): DueLesson[] {
  const done = new Map(progress.filter((p) => p.status === 'done' && p.done_on).map((p) => [p.item_id, p.done_on!]));
  const out: DueLesson[] = [];
  for (const lesson of lessons) {
    const id = lessonItemId(lesson);
    const doneOn = done.get(id);
    if (!doneOn) continue;
    const due = nextReview({ module_id: id, done_on: doneOn }, checks);
    if (due && due <= today) {
      out.push({ lesson, due, reviewsSoFar: checks.filter((c) => c.module_id === id && c.kind === 'review' && c.taken_on >= doneOn).length });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.lesson.id.localeCompare(b.lesson.id));
}

/** A different slice of the lesson's review questions each time it comes back. */
export function pickQuestions(review: Question[], round: number, n = QUESTIONS_PER_LESSON): Question[] {
  if (review.length <= n) return review;
  const start = (round * n) % review.length;
  return Array.from({ length: n }, (_, i) => review[(start + i) % review.length]);
}

/** Same scale as Claude's checks (worker learn.rating_for): 80%+ nailed it, 50%+ struggled, else needed help. */
export function reviewRating(score: number, total: number): Rating {
  const pct = score / total;
  return pct >= 0.8 ? 'nailed' : pct >= 0.5 ? 'struggled' : 'help';
}
