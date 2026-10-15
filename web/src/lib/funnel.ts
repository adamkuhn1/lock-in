import type { Application, Stage } from '../data/types';
import { weekStart } from './time';

export type FunnelStage = 'applied' | 'oa' | 'interview' | 'offer';
export const REFERENCE: Record<FunnelStage, number> = { applied: 582, oa: 54, interview: 13, offer: 5 };
export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied', oa: 'OA', interview: 'Interview', offer: 'Offer', closed: 'Closed', other: 'Other',
};
const FUNNEL: FunnelStage[] = ['applied', 'oa', 'interview', 'offer'];
const RANK: Record<FunnelStage, number> = { applied: 0, oa: 1, interview: 2, offer: 3 };
const INTERVIEW_WORDING = /interview|\bround\b|onsite|on-site|\bfinal (round|interview)\b|phone screen|recruiter screen|technical screen|superday|\br\d\b/;
const OFFER_WORDING = /declined offer|offer declined|after offer|rescinded/;
const NEGATED = /\b(no|not|without|before|never)\s+(an?\s+)?(oa|online assessment|assessment|interview|screen(ing)?)\b/gi;
const OA_WORDING = /\boa\b|online assessment|assessment|hackerrank|codesignal|coding challenge|take[- ]home/;

/** Furthest funnel stage an application reached. A rejection is only recorded as `closed`, so its status text says how far it got. */
export function reachedStage(a: Application): FunnelStage | null {
  switch (a.stage) {
    case 'offer': case 'interview': case 'oa': case 'applied': return a.stage;
    case 'closed': {
      const status = (a.status ?? '').replace(NEGATED, '').toLowerCase();
      if (OFFER_WORDING.test(status)) return 'offer';
      if (INTERVIEW_WORDING.test(status)) return 'interview';
      return OA_WORDING.test(status) ? 'oa' : 'applied';
    }
    default: return null;
  }
}
export const BOARD_ORDER: Stage[] = ['offer', 'interview', 'oa', 'applied', 'closed', 'other'];

/** One funnel stage. active/rejected/passed/passRate are only meaningful for the oa and interview rows. */
export interface FunnelRow {
  stage: FunnelStage; label: string; count: number; pct: number | null; refCount: number; refPct: number | null;
  /** Currently sitting at this stage (oa, interview only). */
  active: number;
  /** Closed after reaching exactly this stage. */
  rejected: number;
  /** Reached a later stage. */
  passed: number;
  /** passed / (passed + rejected), raw percent; null when nothing has resolved. */
  passRate: number | null;
}

// Raw (unrounded) percentages: compare these, and round only when displaying (fmtPct).
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

/** Whole-percent display of a raw rate: 5/13 → "38%", none → "—". */
export const fmtPct = (p: number | null): string => (p === null ? '—' : `${Math.round(p)}%`);

export function funnel(apps: Application[]): FunnelRow[] {
  const reached = apps.map(reachedStage);
  const counts = FUNNEL.map((s) => reached.filter((r) => r !== null && RANK[r] >= RANK[s]).length);
  return FUNNEL.map((stage, i) => {
    const rejected = apps.filter((a, j) => a.stage === 'closed' && reached[j] === stage).length;
    const passed = counts[i + 1] ?? 0;
    return {
      stage,
      label: STAGE_LABEL[stage],
      count: counts[i],
      pct: i === 0 ? null : pct(counts[i], counts[i - 1]),
      refCount: REFERENCE[stage],
      refPct: i === 0 ? null : pct(REFERENCE[stage], REFERENCE[FUNNEL[i - 1]]),
      active: apps.filter((a) => a.stage === stage).length,
      rejected,
      passed,
      passRate: pct(passed, passed + rejected),
    };
  });
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
