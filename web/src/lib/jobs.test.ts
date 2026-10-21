import { describe, expect, it } from 'vitest';
import type { Posting } from '../data/types';
import { NO_FILTERS, filterPostings, locationKey, postingTrack, sortPostings, termsOf, topLocations } from './jobs';

const J = (id: string, over: Partial<Posting> = {}): Posting => ({
  id, company: 'Co', title: 'Software Engineer Intern', location: 'Detroit, MI', url: 'https://x.com/' + id,
  term: 'Winter 2027', posted_at: null, tier: 'A', starred: false, status: 'new', found_at: '2026-10-14T12:00:00Z', ...over,
});

describe('jobs', () => {
  it('postingTrack', () => {
    expect(postingTrack('Software Engineer Intern')).toBe('internship');
    expect(postingTrack('SWE Co-op, Winter 2027')).toBe('internship');
    expect(postingTrack('Software Engineer, New Grad 2027')).toBe('new_grad');
    expect(postingTrack('University Graduate SWE')).toBe('new_grad');
    expect(postingTrack('Software Engineer I')).toBe('new_grad');
    expect(postingTrack('Internal Tools Engineer')).toBeNull();
    expect(postingTrack('Staff Engineer')).toBeNull();
  });
  it('locationKey takes the first location and folds remote', () => {
    expect(locationKey('Chicago, IL; New York, NY')).toBe('Chicago, IL');
    expect(locationKey('Remote - US')).toBe('Remote');
    expect(locationKey(null)).toBeNull();
  });
  it('filters combine', () => {
    const ps = [J('1', { starred: true }), J('2', { title: 'New Grad SWE' }), J('3', { location: 'Remote', term: 'Summer 2027' })];
    expect(filterPostings(ps, { ...NO_FILTERS, starred: true }).map((p) => p.id)).toEqual(['1']);
    expect(filterPostings(ps, { ...NO_FILTERS, track: 'new_grad' }).map((p) => p.id)).toEqual(['2']);
    expect(filterPostings(ps, { ...NO_FILTERS, term: 'Summer 2027', location: 'Remote' }).map((p) => p.id)).toEqual(['3']);
    expect(filterPostings(ps, NO_FILTERS).length).toBe(3);
  });
  it('sorts starred first, then newest', () => {
    const ps = [J('old', { posted_at: '2026-10-10T00:00:00Z' }), J('new', { posted_at: '2026-10-14T00:00:00Z' }), J('star', { starred: true, posted_at: '2026-10-01T00:00:00Z' })];
    expect(sortPostings(ps).map((p) => p.id)).toEqual(['star', 'new', 'old']);
  });
  it('sorts by tier first (A, B, C, then untiered), then starred, then newest', () => {
    const ps = [
      J('c', { tier: 'C', starred: true }), J('none', { tier: null }), J('b-old', { tier: 'B', posted_at: '2026-10-01T00:00:00Z' }),
      J('a', { tier: 'A', posted_at: '2026-09-01T00:00:00Z' }), J('b-new', { tier: 'B', posted_at: '2026-10-13T00:00:00Z' }),
    ];
    expect(sortPostings(ps).map((p) => p.id)).toEqual(['a', 'b-new', 'b-old', 'c', 'none']);
    expect(filterPostings(ps, { ...NO_FILTERS, topTier: true }).map((p) => p.id)).toEqual(['a']);
  });
  it('topLocations and termsOf', () => {
    const ps = [J('1'), J('2'), J('3', { location: 'Ann Arbor, MI', term: null })];
    expect(topLocations(ps)).toEqual(['Detroit, MI', 'Ann Arbor, MI']);
    expect(termsOf(ps)).toEqual(['Winter 2027']);
  });
});

describe('best fit and per-company cap', () => {
  it('Best fit keeps only shortlisted postings, sorted by rank', async () => {
    const { sortByFit } = await import('./jobs');
    const ps = [J('a', { fit_rank: 2 }), J('b'), J('c', { fit_rank: 1 }), J('d', { fit_rank: null })];
    const picked = filterPostings(ps, { ...NO_FILTERS, bestFit: true });
    expect(sortByFit(picked).map((p) => p.id)).toEqual(['c', 'a']);
  });
  it('caps each company and puts a "more" item where the hidden rows start', async () => {
    const { capPerCompany } = await import('./jobs');
    const ps = [J('i1', { company: 'IBM' }), J('r1', { company: 'Ramp' }), J('i2', { company: 'IBM' }), J('i3', { company: 'IBM' }), J('i4', { company: 'IBM' })];
    const label = (xs: ReturnType<typeof capPerCompany>) => xs.map((x) => (x.kind === 'posting' ? x.p.id : `+${x.count} ${x.company}`));
    expect(label(capPerCompany(ps, 2, new Set()))).toEqual(['i1', 'r1', 'i2', '+2 IBM']);
    expect(label(capPerCompany(ps, 2, new Set(['IBM'])))).toEqual(['i1', 'r1', 'i2', 'i3', 'i4']);
  });
});
