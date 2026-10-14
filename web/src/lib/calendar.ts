import type { CalEvent, CompanyPrep, EventKind, Outreach } from '../data/types';
import { addDays, daysBetween, shortDate, weekStart } from './time';

export interface CalItem {
  key: string; title: string; kind: EventKind; on_date: string; at_time: string | null;
  company: string | null; url: string | null; eventId: string | null;
}

export const KIND_LABEL: Record<EventKind, string> = {
  app_open: 'Apps open', deadline: 'Deadline', oa: 'OA', interview: 'Interview', other: 'Other',
};
const PRIORITY: EventKind[] = ['interview', 'oa', 'deadline', 'app_open', 'other'];

export function calendarItems(events: CalEvent[], prep: CompanyPrep[], outreach: Outreach[]): CalItem[] {
  const items: CalItem[] = [
    ...events.map((e) => ({ key: `e:${e.id}`, title: e.title, kind: e.kind, on_date: e.on_date, at_time: e.at_time, company: e.company, url: e.url, eventId: e.id })),
    ...prep.filter((p) => p.interview_on).map((p) => ({
      key: `p:${p.id}`, title: `${p.company} interview`, kind: 'interview' as const, on_date: p.interview_on!, at_time: null, company: p.company, url: null, eventId: null,
    })),
    ...outreach.filter((o) => o.status === 'sent' && o.follow_up_on).map((o) => ({
      key: `o:${o.id}`, title: `Follow up: ${o.company ?? 'outreach'}`, kind: 'other' as const, on_date: o.follow_up_on!, at_time: null, company: o.company, url: null, eventId: null,
    })),
  ];
  return items.sort((a, b) => a.on_date.localeCompare(b.on_date) || (a.at_time ?? '99').localeCompare(b.at_time ?? '99') || a.title.localeCompare(b.title));
}

export const upcoming = (items: CalItem[], today: string) => items.filter((i) => i.on_date >= today);

export function countdown(day: string, today: string): string {
  const n = daysBetween(today, day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1) return `in ${n} days`;
  return n === -1 ? 'yesterday' : `${-n} days ago`;
}

export function groupByWeek(items: CalItem[], today: string): { label: string; items: CalItem[] }[] {
  const thisWeek = weekStart(today);
  const groups = new Map<string, CalItem[]>();
  for (const i of items) {
    const w = weekStart(i.on_date);
    groups.set(w, [...(groups.get(w) ?? []), i]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([w, list]) => ({
    label: w === thisWeek ? 'This week' : w === addDays(thisWeek, 7) ? 'Next week' : `Week of ${shortDate(w)}`,
    items: list,
  }));
}

/** "YYYY-MM" ± n months. */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** Weeks (Mon..Sun) covering the month; days outside the month are null. */
export function monthGrid(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const next = `${addMonths(month, 1)}-01`;
  const start = weekStart(first);
  const weeks: (string | null)[][] = [];
  for (let d = start; d < next; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const day = addDays(d, i);
      return day >= first && day < next ? day : null;
    }));
  }
  return weeks;
}

export function dotKind(items: CalItem[]): EventKind | null {
  for (const k of PRIORITY) if (items.some((i) => i.kind === k)) return k;
  return null;
}

const when = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

export function weekFocus(items: CalItem[], today: string, appTarget: number): { text: string; to: string | null } {
  const soon = items.filter((i) => { const n = daysBetween(today, i.on_date); return n >= 0 && n <= 7; });
  const first = (k: EventKind) => soon.find((i) => i.kind === k);
  const iv = first('interview');
  if (iv) return { text: `Interview ${when(daysBetween(today, iv.on_date))}: mock + company notes`, to: '/grind/prep' };
  const oa = first('oa');
  if (oa) return { text: `OA ${when(daysBetween(today, oa.on_date))}: daily OA practice`, to: '/grind/prep' };
  const dl = first('deadline');
  if (dl) return { text: `Deadline ${when(daysBetween(today, dl.on_date))}: ${dl.title}`, to: null };
  return { text: `Volume week: hit ${appTarget} applications`, to: '/hunt/jobs' };
}
