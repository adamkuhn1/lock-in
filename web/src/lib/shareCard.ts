import type { TodayStats } from '../data/useTodayStats';
import type { DayActivity } from './activity';

export const CARD_W = 1080;
export const CARD_H = 1920;

export interface CardData {
  dateLine: string; day: number; streak: number; weeks: (DayActivity | null)[][];
  lcDone: number; lcTotal: number; appsWeek: number; emailsWeek: number; funnel: number[]; showFunnel: boolean;
}

export function toCardData(s: TodayStats, showFunnel: boolean): CardData {
  return {
    dateLine: s.dateLine, day: s.n, streak: s.streak, weeks: s.weeks, lcDone: s.lcDone, lcTotal: s.lcTotal,
    appsWeek: s.appsWeek, emailsWeek: s.emailsWeek, funnel: s.funnel.map((r) => r.count), showFunnel,
  };
}

export function caption(d: CardData): string {
  return `Day ${d.day} of locking in for SWE internships 🔒 | 🔥 ${d.streak} day streak | ${d.lcDone} LeetCode · ${d.appsWeek} apps this week #cs #swe #internship`;
}

// Canvas can't read CSS variables; these mirror tokens.css.
const C = { bg: '#000000', text: '#ffffff', muted: '#a3a3a3', orange: '#ff4d1a', heat: ['#1a1a1a', '#4a1f10', '#7a2c12', '#c23f15', '#ff4d1a'] };
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const PAD = 90;

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function stat(ctx: CanvasRenderingContext2D, x: number, y: number, value: string, label: string, size = 120) {
  ctx.fillStyle = C.text;
  ctx.font = `800 ${size}px ${DISPLAY}`;
  ctx.fillText(value, x, y);
  ctx.fillStyle = C.muted;
  ctx.font = `500 34px ${DISPLAY}`;
  ctx.fillText(label, x, y + 50);
}

export function drawCard(ctx: CanvasRenderingContext2D, d: CardData): void {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = C.muted;
  ctx.font = `500 46px ${DISPLAY}`;
  ctx.fillText(d.dateLine, PAD, 200);
  if (d.streak > 0) {
    ctx.fillStyle = C.orange;
    ctx.fillText(`🔥 ${d.streak} DAY STREAK`, PAD, 262);
  }

  ctx.font = `italic 800 250px ${DISPLAY}`;
  ctx.fillStyle = C.text;
  ctx.fillText('DAY', PAD, 520);
  ctx.fillStyle = C.orange;
  ctx.fillText(String(d.day), PAD, 750);

  const weeks = d.weeks.slice(-18);
  const cell = 42, gap = 8, top = 830;
  weeks.forEach((w, x) => w.forEach((c, y) => {
    if (!c) return;
    ctx.fillStyle = C.heat[c.intensity];
    box(ctx, PAD + x * (cell + gap), top + y * (cell + gap), cell, cell, 8);
  }));

  const sy = top + 7 * (cell + gap) + 150;
  stat(ctx, PAD, sy, `${d.lcDone}/${d.lcTotal}`, 'LEETCODE TODAY');
  stat(ctx, PAD + 330, sy, String(d.appsWeek), 'APPS THIS WEEK');
  stat(ctx, PAD + 660, sy, String(d.emailsWeek), 'EMAILS THIS WEEK');

  if (d.showFunnel) {
    const fy = sy + 250;
    ['APPS', 'OAS', 'INTERVIEWS', 'OFFERS'].forEach((label, i) => stat(ctx, PAD + i * 230, fy, String(d.funnel[i] ?? 0), label, 96));
  }

  ctx.fillStyle = C.muted;
  ctx.font = `italic 800 56px ${DISPLAY}`;
  ctx.fillText('LOCK-IN', PAD, CARD_H - 110);
}
