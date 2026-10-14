import { describe, expect, it } from 'vitest';
import { SOURCE_LABEL, anyStale, isStale } from './sync';

const now = new Date('2026-10-14T12:00:00Z');
const row = (last_ok_at: string | null) => ({ source: 'sheet', last_ok_at, last_error: null, consecutive_failures: 0 });

describe('sync staleness', () => {
  it('stale after 2 hours or never synced', () => {
    expect(isStale(row('2026-10-14T10:30:00Z'), now)).toBe(false);
    expect(isStale(row('2026-10-14T09:59:00Z'), now)).toBe(true);
    expect(isStale(row(null), now)).toBe(true);
  });
  it('labels every worker source (M7)', () => {
    expect(SOURCE_LABEL.plan).toBe('Daily plan');
    expect(SOURCE_LABEL.nudges).toBe('Nudges');
  });
  it('anyStale', () => {
    expect(anyStale([row('2026-10-14T11:00:00Z')], now)).toBe(false);
    expect(anyStale([row('2026-10-14T11:00:00Z'), row(null)], now)).toBe(true);
    expect(anyStale([], now)).toBe(false);
  });
});
