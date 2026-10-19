import type { Application, Outreach, Solve } from '../data/types';
import type { DayActivity } from './activity';
import { reachedStage } from './funnel';
import { weekStart } from './time';

export interface SeasonRecord {
  longestStreak: number; activeDays: number; applications: number; solved: number; emails: number;
  interviews: number; offers: number; bestWeek: { start: string; count: number } | null;
}

/** Personal bests and totals for the Me tab, from the same data as Today. */
export function seasonRecord(days: DayActivity[], apps: Application[], solves: Pick<Solve, 'slug'>[], outreach: Pick<Outreach, 'sent_on'>[]): SeasonRecord {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.active ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const weeks = new Map<string, number>();
  for (const a of apps) if (a.applied_on) weeks.set(weekStart(a.applied_on), (weeks.get(weekStart(a.applied_on)) ?? 0) + 1);
  const best = [...weeks.entries()].sort((x, y) => y[1] - x[1] || y[0].localeCompare(x[0]))[0];
  const reached = apps.map(reachedStage);
  return {
    longestStreak: longest,
    activeDays: days.filter((d) => d.active).length,
    applications: apps.length,
    solved: new Set(solves.map((s) => s.slug)).size,
    emails: outreach.filter((o) => o.sent_on).length,
    interviews: reached.filter((s) => s === 'interview' || s === 'offer').length,
    offers: reached.filter((s) => s === 'offer').length,
    bestWeek: best ? { start: best[0], count: best[1] } : null,
  };
}
