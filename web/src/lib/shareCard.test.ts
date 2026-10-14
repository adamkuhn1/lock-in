import { describe, expect, it } from 'vitest';
import { dayActivity, heatmapWeeks } from './activity';
import { CARD_H, CARD_W, caption, drawCard, type CardData } from './shareCard';

function fakeCtx() {
  const texts: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (t, k) => (k === 'fillText' ? (s: string) => { texts.push(s); } : k in t ? t[k as string] : () => {}),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const days = dayActivity({ solves: [], applications: [{ applied_on: '2026-10-14' }], outreach: [], commits: [], prep: [] }, '2026-09-28', '2026-10-14');
const data: CardData = {
  dateLine: 'WED 10/14', day: 17, streak: 12, weeks: heatmapWeeks(days), lcDone: 4, lcTotal: 6,
  appsWeek: 18, emailsWeek: 3, funnel: [142, 11, 3, 0], showFunnel: true,
};

describe('share card', () => {
  it('is TikTok portrait size', () => { expect([CARD_W, CARD_H]).toEqual([1080, 1920]); });

  it('draws day, streak, stats, funnel and wordmark', () => {
    const { ctx, texts } = fakeCtx();
    drawCard(ctx, data);
    for (const t of ['WED 10/14', '🔥 12 DAY STREAK', 'DAY', '17', '4/6', '18', '3', 'LEETCODE TODAY', 'APPS THIS WEEK', 'EMAILS THIS WEEK', '142', 'INTERVIEWS', 'LOCK-IN']) {
      expect(texts).toContain(t);
    }
  });

  it('hides the funnel and a zero streak', () => {
    const { ctx, texts } = fakeCtx();
    drawCard(ctx, { ...data, showFunnel: false, streak: 0 });
    expect(texts).not.toContain('INTERVIEWS');
    expect(texts.some((t) => t.includes('STREAK'))).toBe(false);
  });

  it('caption', () => {
    expect(caption(data)).toBe('Day 17 of locking in for SWE internships 🔒 | 🔥 12 day streak | 4 LeetCode · 18 apps this week #cs #swe #internship');
  });
});
