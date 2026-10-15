import { describe, expect, it } from 'vitest';
import type { Application, Stage } from '../data/types';
import { appliedThisWeek, fmtPct, funnel, groupByStage, reachedStage, searchApps } from './funnel';

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
    expect(rows.map((r) => [r.stage, r.count])).toEqual([['applied', 12], ['oa', 4], ['interview', 2], ['offer', 1]]);
    expect(rows.map((r) => r.refCount)).toEqual([582, 54, 13, 5]);
    expect(rows[0].pct).toBeNull();
    expect(rows[0].refPct).toBeNull();
    expect(rows[1].pct).toBeCloseTo((4 / 12) * 100, 10);
    expect(rows[3].refPct).toBeCloseTo((5 / 13) * 100, 10); // raw, not pre-rounded to 38.5
  });
  it('rounds only at display: the benchmark reads 9%, 24%, 38%', () => {
    const rows = funnel([]);
    expect(rows.map((r) => fmtPct(r.refPct))).toEqual(['—', '9%', '24%', '38%']);
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(20)).toBe('20%');
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

const closed = (status: string): Application => ({ ...A('closed'), status });

describe('reachedStage', () => {
  it('maps open stages directly and other to null', () => {
    expect((['applied', 'oa', 'interview', 'offer', 'other'] as Stage[]).map((s) => reachedStage(A(s)))).toEqual(['applied', 'oa', 'interview', 'offer', null]);
  });
  it('plain rejections reached applied only', () => {
    for (const s of ['Rejected', 'No response', '']) expect(reachedStage(closed(s))).toBe('applied');
    expect(reachedStage({ ...A('closed'), status: null })).toBe('applied');
  });
  it('rejections after an OA reached oa', () => {
    for (const s of ['Rejected after OA', 'rejected - hackerrank', 'Rejected post CodeSignal', 'Rejected after online assessment']) expect(reachedStage(closed(s))).toBe('oa');
  });
  it('rejections after an interview reached interview, ahead of OA wording', () => {
    for (const s of ['Rejected after final round', 'rejected after phone screen', 'Rejected after OA and interview', 'Rejected R2']) expect(reachedStage(closed(s))).toBe('interview');
  });
});

describe('reachedStage negations and offer wording', () => {
  it('negated OA / interview / screen wording only reached applied', () => {
    for (const s of ['Rejected - no OA', 'Rejected before OA', 'Rejected - resume screen', 'Ghosted - no interview', 'Rejected without an interview']) expect(reachedStage(closed(s))).toBe('applied');
  });
  it('real screens and final rounds reached interview', () => {
    for (const s of ['Rejected after phone screen', 'Rejected after recruiter screen', 'Rejected after technical screen', 'Rejected after final round', 'Rejected after final interview']) expect(reachedStage(closed(s))).toBe('interview');
  });
  it('bare final is not interview wording', () => {
    expect(reachedStage(closed('Rejected - final decision'))).toBe('applied');
  });
  it('closed after an offer reached offer', () => {
    for (const s of ['Declined offer', 'Offer declined', 'Rejected after offer', 'Offer rescinded']) expect(reachedStage(closed(s))).toBe('offer');
  });
});

describe('funnel OA tracking', () => {
  const apps = [A('oa'), closed('Rejected after OA'), closed('rejected - hackerrank'), A('interview')];
  it('counts rejected-after-OA as having reached OA', () => {
    const rows = funnel(apps);
    expect(rows.map((r) => r.count)).toEqual([4, 4, 1, 0]);
  });
  it('computes active, rejected, passed and passRate', () => {
    const oa = funnel(apps)[1];
    expect([oa.active, oa.rejected, oa.passed]).toEqual([1, 2, 1]);
    expect(oa.passRate).toBeCloseTo((1 / 3) * 100, 10);
    expect(fmtPct(oa.passRate)).toBe('33%');
  });
  it('tracks interview rejections and active interviews', () => {
    const rows = funnel([A('interview'), closed('Rejected after final round'), A('offer')]);
    expect([rows[2].active, rows[2].rejected, rows[2].passed]).toEqual([1, 1, 1]);
    expect(fmtPct(rows[2].passRate)).toBe('50%');
  });
  it('zero denominator gives a dash', () => {
    const oa = funnel([A('oa')])[1];
    expect([oa.active, oa.rejected, oa.passed, oa.passRate]).toEqual([1, 0, 0, null]);
    expect(fmtPct(oa.passRate)).toBe('—');
  });
});
