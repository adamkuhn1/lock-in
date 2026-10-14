import type { DailySet, Difficulty, Problem, Rating, Slot, Solve } from '../data/types';
import { planDay } from './time';

export interface TodayItem {
  slug: string;
  title: string;
  difficulty: Difficulty | null;
  url: string;
  slot: Slot;
  done: boolean;
  solve: Solve | null; // the solve a rating goes on (the rated one, else the first of the day)
  needsRating: boolean;
  topicHidden: boolean;
  topicLabel: string | null;
}

export const RATINGS: { value: Rating; emoji: string; label: string }[] = [
  { value: 'nailed', emoji: '🟢', label: 'Nailed it' },
  { value: 'struggled', emoji: '🟡', label: 'Struggled' },
  { value: 'help', emoji: '🔴', label: 'Needed help' },
];

export const problemUrl = (slug: string) => `https://leetcode.com/problems/${encodeURIComponent(slug)}/`;

/** Only unapplied solves can still be rated; the worker applies each solve once. */
export const canRate = (s: { applied_at?: string | null }): boolean => s.applied_at == null;

function solvesByDay(solves: Solve[], day: string): Map<string, Solve[]> {
  const out = new Map<string, Solve[]>();
  for (const s of solves) {
    if (planDay(new Date(s.accepted_at)) !== day) continue;
    out.set(s.slug, [...(out.get(s.slug) ?? []), s]);
  }
  for (const list of out.values()) list.sort((a, b) => Date.parse(a.accepted_at) - Date.parse(b.accepted_at));
  return out;
}

export function buildTodayItems(set: DailySet, solves: Solve[], problems: Map<string, Problem>, day: string): TodayItem[] {
  const byslug = solvesByDay(solves, day);
  return [...set.items]
    .sort((a, b) => a.order - b.order)
    .map((it) => {
      const p = problems.get(it.slug) ?? null;
      const daySolves = byslug.get(it.slug) ?? [];
      const solved = daySolves.length > 0;
      const rated = daySolves.find((s) => s.rating) ?? null;
      const secret = it.slot === 'mystery' || set.mixed_day;
      const topicHidden = secret && !solved;
      const offFocus = p !== null && p.topic !== set.focus;
      return {
        slug: it.slug,
        title: p?.title ?? it.slug.replace(/-/g, ' '),
        difficulty: p?.difficulty ?? null,
        url: problemUrl(it.slug),
        slot: it.slot,
        done: it.done || solved,
        solve: rated ?? daySolves[0] ?? null,
        needsRating: solved && !rated,
        topicHidden,
        topicLabel: topicHidden || !p || !(secret || offFocus) ? null : p.topic,
      };
    });
}
