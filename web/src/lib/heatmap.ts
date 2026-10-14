import type { Solve } from '../data/types';
import { addDays, localDay, weekStart } from './time';

export function heatmap(solves: Solve[], today: string, weeks = 26) {
  const counts = new Map<string, number>();
  for (const s of solves) {
    const d = localDay(new Date(s.accepted_at));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const start = addDays(weekStart(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = addDays(start, w * 7 + d);
      return { day, count: counts.get(day) ?? 0, future: day > today };
    }));
}

export function intensity(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}
