import type { Level, Problem, ProblemState, Solve, Topic, TopicState } from '../data/types';
import { addDays } from './time';

export const LEVEL_LABEL: Record<Level, string> = {
  locked: 'Locked', available: 'Ready', learning: 'Learning', practicing: 'Practicing', solid: 'Solid', mastered: 'Mastered',
};

export function roadmapRows(topics: Topic[], states: TopicState[], focus: string | null) {
  const level = new Map(states.map((s) => [s.topic, s.level]));
  const tiers = new Map<number, { name: string; level: Level; isFocus: boolean; prereqs: string[] }[]>();
  for (const t of [...topics].sort((a, b) => a.ord - b.ord)) {
    const row = {
      name: t.name,
      level: level.get(t.name) ?? (t.prereqs.length === 0 ? 'available' : 'locked'),
      isFocus: t.name === focus,
      prereqs: t.prereqs,
    };
    tiers.set(t.tier, [...(tiers.get(t.tier) ?? []), row]);
  }
  return [...tiers.entries()].sort((a, b) => a[0] - b[0]).map(([tier, list]) => ({ tier, topics: list }));
}

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

export function topicCounts(solves: Solve[], problems: Map<string, Problem>, topic: string) {
  const out = { Easy: 0, Medium: 0, Hard: 0 };
  for (const slug of new Set(solves.map((s) => s.slug))) {
    const p = problems.get(slug);
    if (p && p.topic === topic) out[p.difficulty] += 1;
  }
  return out;
}
