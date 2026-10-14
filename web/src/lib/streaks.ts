import type { Application, Commit, Solve } from '../data/types';
import { addDays, daysBetween, localDay } from './time';

export function streak(days: Set<string>, today: string): number {
  let cur = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(cur)) {
    n += 1;
    cur = addDays(cur, -1);
  }
  return n;
}

export function streaks(solves: Solve[], commits: Commit[], apps: Application[], now: Date) {
  const today = localDay(now);
  return {
    leetcode: streak(new Set(solves.map((s) => localDay(new Date(s.accepted_at)))), today),
    project: streak(new Set(commits.map((c) => localDay(new Date(c.committed_at)))), today),
    apps: streak(new Set(apps.flatMap((a) => (a.applied_on ? [a.applied_on] : []))), today),
  };
}

export function dayNumber(startedOn: string | null, day: string): number | null {
  return startedOn ? daysBetween(startedOn, day) + 1 : null;
}
