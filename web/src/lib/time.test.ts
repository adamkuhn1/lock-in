import { describe, expect, it } from 'vitest';
import planDayCases from '../../../shared/plan-day-cases.json';
import { addDays, daysBetween, localDay, planDay, relativeTime, shortDate, weekStart } from './time';

describe('time', () => {
  it('localDay uses Detroit, not UTC (23:50 EDT)', () => {
    expect(localDay(new Date('2026-10-15T03:50:00Z'))).toBe('2026-10-14');
  });
  it('planDay before 4 AM is the previous day', () => {
    expect(planDay(new Date('2026-10-15T07:30:00Z'))).toBe('2026-10-14'); // 03:30 EDT
  });
  it('planDay at 4 AM is the new day', () => {
    expect(planDay(new Date('2026-10-15T08:00:00Z'))).toBe('2026-10-15'); // 04:00 EDT
  });
  it('planDay in winter (EST, UTC-5)', () => {
    expect(planDay(new Date('2026-12-02T08:30:00Z'))).toBe('2026-12-01'); // 03:30 EST
    expect(planDay(new Date('2026-12-02T09:00:00Z'))).toBe('2026-12-02'); // 04:00 EST
  });
  // I1: shared with worker/tests/test_clock.py (DST boundaries).
  for (const c of planDayCases.cases) {
    it(`planDay(${c.instant}) is ${c.plan_day}`, () => {
      expect(planDay(new Date(c.instant))).toBe(c.plan_day);
    });
  }
  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-10-30', 5)).toBe('2026-11-04');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-04', -5)).toBe('2026-10-30');
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-10-03', '2026-10-14')).toBe(11);
    expect(daysBetween('2026-10-14', '2026-10-14')).toBe(0);
  });
  it('weekStart is Monday', () => {
    expect(weekStart('2026-10-14')).toBe('2026-10-12'); // Wednesday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
  });
  it('relativeTime', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(relativeTime('2026-10-14T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-14T11:55:00Z', now)).toBe('5m ago');
    expect(relativeTime('2026-10-14T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-10-12T12:00:00Z', now)).toBe('2d ago');
  });
  it('shortDate', () => {
    expect(shortDate('2026-10-14')).toBe('Oct 14');
  });
});
