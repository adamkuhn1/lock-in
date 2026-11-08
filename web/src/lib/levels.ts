import type { Problem, ProblemState } from '../data/types';
import { addDays } from './time';

export function reviewQueue(states: ProblemState[], problems: Map<string, Problem>, today: string) {
  return states
    .filter((s) => s.state !== 'retained' && s.due_on !== null && s.due_on <= today)
    .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''))
    .map((state) => ({ state, problem: problems.get(state.slug) ?? null }));
}

export function upcomingReviews(states: ProblemState[], today: string, days: number): number {
  const end = addDays(today, days);
  return states.filter((s) => s.state !== 'retained' && s.due_on !== null && s.due_on > today && s.due_on <= end).length;
}
