import { addDays } from './time';

export function streak(days: Set<string>, today: string): number {
  let cur = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(cur)) {
    n += 1;
    cur = addDays(cur, -1);
  }
  return n;
}
