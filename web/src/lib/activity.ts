import type { Application, Commit, Outreach, PrepSession, Solve } from '../data/types';
import { streak } from './streaks';
import { TZ, addDays, daysBetween, planDay, weekStart } from './time';

export interface ActivityInput {
  solves: Pick<Solve, 'accepted_at'>[];
  applications: Pick<Application, 'applied_on'>[];
  outreach: Pick<Outreach, 'sent_on'>[];
  commits: Pick<Commit, 'committed_at'>[];
  prep: Pick<PrepSession, 'happened_on'>[];
}
export interface DayActivity {
  day: string; solves: number; applications: number; outreach: number; commits: number; prep: number;
  kinds: number; intensity: 0 | 1 | 2 | 3 | 4; active: boolean;
}

function tally(days: (string | null)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of days) if (d) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
}

export function dayN(dayOne: string, today: string): number {
  return dayOne > today ? 0 : daysBetween(dayOne, today) + 1;
}

/** One entry per plan day from dayOne through today. Mirrors the SQL view public.day_activity. */
export function dayActivity(input: ActivityInput, dayOne: string, today: string): DayActivity[] {
  const n = dayN(dayOne, today);
  if (n === 0) return [];
  const s = tally(input.solves.map((x) => planDay(new Date(x.accepted_at))));
  const a = tally(input.applications.map((x) => x.applied_on));
  const o = tally(input.outreach.map((x) => x.sent_on));
  const c = tally(input.commits.map((x) => planDay(new Date(x.committed_at))));
  const p = tally(input.prep.map((x) => x.happened_on));
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(dayOne, i);
    const row = { day, solves: s.get(day) ?? 0, applications: a.get(day) ?? 0, outreach: o.get(day) ?? 0, commits: c.get(day) ?? 0, prep: p.get(day) ?? 0 };
    const kinds = [row.solves, row.applications, row.outreach, row.commits, row.prep].filter((v) => v > 0).length;
    return { ...row, kinds, intensity: Math.min(kinds, 4) as DayActivity['intensity'], active: kinds > 0 };
  });
}

export function activeStreak(days: DayActivity[], today: string): number {
  return streak(new Set(days.filter((d) => d.active).map((d) => d.day)), today);
}

/** Columns of 7 (Mon..Sun), oldest first; null where a cell falls outside the days given. */
export function heatmapWeeks(days: DayActivity[]): (DayActivity | null)[][] {
  if (days.length === 0) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const start = weekStart(days[0].day);
  const weeks = Math.floor(daysBetween(start, weekStart(days[days.length - 1].day)) / 7) + 1;
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, i) => byDay.get(addDays(start, w * 7 + i)) ?? null));
}

const lineFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric' });
/** "WED 10/14" for the plan day of `now`. */
export function dayLine(now: Date): string {
  const p: Record<string, string> = {};
  const shifted = new Date(now.getTime() - 4 * 3_600_000);
  for (const part of lineFmt.formatToParts(shifted)) p[part.type] = part.value;
  return `${p.weekday.toUpperCase()} ${p.month}/${p.day}`;
}
