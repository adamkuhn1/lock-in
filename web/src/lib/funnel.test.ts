import { describe, expect, it } from 'vitest';
import type { Application, Stage } from '../data/types';
import { appliedThisWeek, funnel, groupByStage, searchApps } from './funnel';

let id = 0;
const A = (stage: Stage, applied_on: string | null = '2026-10-01', company = `Co${id}`): Application => ({
  id: id++, company, role: 'SWE Intern', track: null, term: null, location: null, status: stage, stage, priority: null, applied_on,
});

describe('funnel', () => {
  const apps = [
    ...Array.from({ length: 6 }, () => A('applied')), A('closed'), A('closed'),
    A('oa'), A('oa'), A('interview'), A('offer'), A('other'),
  ];
  it('counts everyone who reached each stage and converts stage to stage', () => {
    const rows = funnel(apps);
    expect(rows.map((r) => [r.stage, r.count, r.pct])).toEqual([
      ['applied', 12, null], ['oa', 4, 33.3], ['interview', 2, 50], ['offer', 1, 50],
    ]);
    expect(rows.map((r) => [r.refCount, r.refPct])).toEqual([[582, null], [54, 9.3], [13, 24.1], [5, 38.5]]);
  });
  it('zero divisions show no percentage', () => {
    expect(funnel([]).map((r) => r.pct)).toEqual([null, null, null, null]);
  });
  it('appliedThisWeek counts Monday..today only', () => {
    const week = [A('applied', '2026-10-12'), A('applied', '2026-10-14'), A('applied', '2026-10-11'), A('oa', '2026-10-13'), A('applied', null)];
    expect(appliedThisWeek(week, '2026-10-14')).toBe(3);
  });
  it('groups most advanced first, newest first, and drops empty stages', () => {
    const g = groupByStage([A('applied', '2026-10-01'), A('applied', '2026-10-09'), A('offer')]);
    expect(g.map(([s, list]) => [s, list.length])).toEqual([['offer', 1], ['applied', 2]]);
    expect(g[1][1][0].applied_on).toBe('2026-10-09');
  });
  it('search matches company, role or status, case-insensitive', () => {
    const list = [A('applied', null, 'Stripe'), A('oa', null, 'Ramp')];
    expect(searchApps(list, 'strip').map((a) => a.company)).toEqual(['Stripe']);
    expect(searchApps(list, '  ').length).toBe(2);
    expect(searchApps(list, 'OA').map((a) => a.company)).toEqual(['Ramp']);
  });
});
