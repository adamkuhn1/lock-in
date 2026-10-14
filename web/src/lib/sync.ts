import type { SyncStatus } from '../data/types';

export const STALE_HOURS = 2;
export const SOURCE_LABEL: Record<string, string> = {
  leetcode: 'LeetCode', github: 'GitHub', sheet: 'Sheet', jobs: 'Jobs', plan: 'Daily plan', nudges: 'Nudges',
};

export function isStale(row: SyncStatus, now: Date): boolean {
  if (!row.last_ok_at) return true;
  return now.getTime() - Date.parse(row.last_ok_at) > STALE_HOURS * 3_600_000;
}

export const anyStale = (rows: SyncStatus[], now: Date) => rows.some((r) => isStale(r, now));
