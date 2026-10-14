import type { Posting } from '../data/types';

export type Track = 'internship' | 'new_grad';
export interface JobFilters { starred: boolean; track: Track | null; term: string | null; location: string | null }
export const NO_FILTERS: JobFilters = { starred: false, track: null, term: null, location: null };

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
    (!f.starred || p.starred) &&
    (!f.track || postingTrack(p.title) === f.track) &&
    (!f.term || p.term === f.term) &&
    (!f.location || locationKey(p.location) === f.location));
}

const when = (p: Posting) => Date.parse(p.posted_at ?? p.found_at);

export function sortPostings(ps: Posting[]): Posting[] {
  return [...ps].sort((a, b) => Number(b.starred) - Number(a.starred) || when(b) - when(a));
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
