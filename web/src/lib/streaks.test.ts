import { describe, expect, it } from 'vitest';
import { streak } from './streaks';

describe('streaks', () => {
  it('counts back from today, or from yesterday if today is not done yet', () => {
    expect(streak(new Set(['2026-10-14', '2026-10-13', '2026-10-12']), '2026-10-14')).toBe(3);
    expect(streak(new Set(['2026-10-13', '2026-10-12']), '2026-10-14')).toBe(2);
    expect(streak(new Set(['2026-10-12']), '2026-10-14')).toBe(0);
    expect(streak(new Set(), '2026-10-14')).toBe(0);
  });
});
