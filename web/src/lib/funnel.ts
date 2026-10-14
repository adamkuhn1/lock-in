import type { Application, Stage } from '../data/types';
import { weekStart } from './time';

export type FunnelStage = 'applied' | 'oa' | 'interview' | 'offer';
export const REFERENCE: Record<FunnelStage, number> = { applied: 582, oa: 54, interview: 13, offer: 5 };
export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied', oa: 'OA', interview: 'Interview', offer: 'Offer', closed: 'Closed', other: 'Other',
};
const FUNNEL: FunnelStage[] = ['applied', 'oa', 'interview', 'offer'];
// "Reached" counts: a rejection after an OA is recorded only as `closed`, so it counts as applied.
const REACHED: Record<FunnelStage, Stage[]> = {
  applied: ['applied', 'oa', 'interview', 'offer', 'closed'],
  oa: ['oa', 'interview', 'offer'],
  interview: ['interview', 'offer'],
  offer: ['offer'],
};
export const BOARD_ORDER: Stage[] = ['offer', 'interview', 'oa', 'applied', 'closed', 'other'];

export interface FunnelRow { stage: FunnelStage; label: string; count: number; pct: number | null; refCount: number; refPct: number | null }

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function funnel(apps: Application[]): FunnelRow[] {
  const counts = FUNNEL.map((s) => apps.filter((a) => REACHED[s].includes(a.stage)).length);
  return FUNNEL.map((stage, i) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: counts[i],
    pct: i === 0 ? null : pct(counts[i], counts[i - 1]),
    refCount: REFERENCE[stage],
    refPct: i === 0 ? null : pct(REFERENCE[stage], REFERENCE[FUNNEL[i - 1]]),
  }));
}

export function appliedThisWeek(apps: Application[], today: string): number {
  const start = weekStart(today);
  return apps.filter((a) => a.applied_on !== null && a.applied_on >= start && a.applied_on <= today).length;
}

export function groupByStage(apps: Application[]): [Stage, Application[]][] {
  return BOARD_ORDER.map((stage): [Stage, Application[]] => [
    stage,
    apps.filter((a) => a.stage === stage).sort((a, b) => (b.applied_on ?? '').localeCompare(a.applied_on ?? '')),
  ]).filter(([, list]) => list.length > 0);
}

export function searchApps(apps: Application[], q: string): Application[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return apps;
  return apps.filter((a) => [a.company, a.role, a.status].some((f) => (f ?? '').toLowerCase().includes(needle)));
}
