export const TZ = 'America/Detroit';
const PLAN_DAY_START_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function localDay(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of dayFmt.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

export function planDay(now: Date): string {
  return localDay(new Date(now.getTime() - PLAN_DAY_START_MS));
}

function utcMidnight(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

export function addDays(iso: string, n: number): string {
  return new Date(utcMidnight(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / DAY_MS);
}

export function weekStart(iso: string): string {
  const dow = (new Date(utcMidnight(iso)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

export function relativeTime(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function shortDate(iso: string): string {
  return new Date(utcMidnight(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
