import type { Posting, Tier } from '../data/types';
import { tierRank } from './tiers';

export type Track = 'internship' | 'new_grad';
export interface JobFilters { bestFit: boolean; starred: boolean; tier: Tier | null; track: Track | null; term: string | null; location: string | null }
export const NO_FILTERS: JobFilters = { bestFit: false, starred: false, tier: null, track: null, term: null, location: null };
export type JobSort = 'tier' | 'newest';

export const isBestFit = (p: Posting) => p.fit_rank != null;

export function postingTrack(title: string): Track | null {
  if (/\b(intern|internship|co-?op)\b/i.test(title)) return 'internship';
  if (/\bnew[- ]grad|\bgraduate\b|early[- ]career|entry[- ]level|\b(engineer|developer) i\b/i.test(title)) return 'new_grad';
  return null;
}

export function locationKey(loc: string | null): string | null {
  if (!loc) return null;
  const first = loc.split(/[;|]/)[0].trim();
  if (!first) return null;
  return /remote/i.test(first) ? 'Remote' : first;
}

export function filterPostings(ps: Posting[], f: JobFilters): Posting[] {
  return ps.filter((p) =>
    (!f.bestFit || isBestFit(p)) &&
    (!f.starred || p.starred) &&
    (!f.tier || p.tier === f.tier) &&
    (!f.track || postingTrack(p.title) === f.track) &&
    (!f.term || p.term === f.term) &&
    (!f.location || locationKey(p.location) === f.location));
}

const when = (p: Posting) => Date.parse(p.posted_at ?? p.found_at);

/** By tier (reach, Midwest, volume), starred first within a tier, newest first; or newest first overall. */
export function sortPostings(ps: Posting[], by: JobSort = 'tier'): Posting[] {
  if (by === 'newest') return [...ps].sort((a, b) => when(b) - when(a));
  return [...ps].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || Number(b.starred) - Number(a.starred) || when(b) - when(a));
}

export function topLocations(ps: Posting[], n = 6): string[] {
  const counts = new Map<string, number>();
  for (const p of ps) {
    const k = locationKey(p.location);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
}

export function termsOf(ps: Posting[]): string[] {
  return [...new Set(ps.flatMap((p) => (p.term ? [p.term] : [])))].sort();
}

/** The Best fit shortlist in Claude's order. */
export function sortByFit(ps: Posting[]): Posting[] {
  return [...ps].sort((a, b) => (a.fit_rank ?? Infinity) - (b.fit_rank ?? Infinity));
}

export type InboxItem = { kind: 'posting'; p: Posting } | { kind: 'more'; company: string; count: number };

/**
 * At most `per` postings from each company, in the given order, so one big employer can't fill the inbox
 * (IBM posts the same role in eight cities). Companies in `expanded` show everything; the rest get a
 * "more" item where their hidden postings would start.
 */
export function capPerCompany(ps: Posting[], per: number, expanded: ReadonlySet<string>): InboxItem[] {
  const total = new Map<string, number>();
  for (const p of ps) total.set(p.company, (total.get(p.company) ?? 0) + 1);
  const shown = new Map<string, number>();
  const out: InboxItem[] = [];
  for (const p of ps) {
    const n = (shown.get(p.company) ?? 0) + 1;
    shown.set(p.company, n);
    if (n <= per || expanded.has(p.company)) out.push({ kind: 'posting', p });
    else if (n === per + 1) out.push({ kind: 'more', company: p.company, count: total.get(p.company)! - per });
  }
  return out;
}
