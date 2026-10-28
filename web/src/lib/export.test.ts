import { describe, expect, it } from 'vitest';
import { createDemoApi } from '../data/demo';
import { buildExport, exportFilename, exportSummary } from './export';

const NOW = new Date('2026-10-14T16:00:00Z');

describe('export', () => {
  it('gathers every section from the data layer', async () => {
    const api = createDemoApi(NOW);
    await api.updateSettings({ profile: { github: 'https://github.com/adamkuhn1', linkedin: 'linkedin.com/in/adamk' } });
    const out = await buildExport(api, NOW);
    expect(out.exported_at).toBe(NOW.toISOString());
    expect(out.applications).toHaveLength(21);
    expect(out.postings).toHaveLength(9);
    expect(out.projects.projects.map((p) => p.id)).toEqual(['27b', 'showboat', 'lego']);
    expect(out.summary.applications.total).toBe(21);
    expect(out.summary.leetcode.solved).toBe(new Set(out.leetcode.solves.map((s) => s.slug)).size);
    expect(out.links.github).toBe('https://github.com/adamkuhn1');
    expect(out.links.linkedin).toBe('linkedin.com/in/adamk');
    expect(out.links.portfolio).toBeNull();
    expect(out.links.projects.every((p) => p.url.startsWith('https://github.com/'))).toBe(true);
    expect(out.resumes.base).toMatch(/Base_Resume\/Adam_Kuhn_Resume\.pdf$/);
    expect(() => JSON.stringify(out)).not.toThrow();
  });
  it('counts a problem solved twice once, by difficulty', () => {
    const solve = (slug: string) => ({ id: 0, slug, title: slug, accepted_at: '', rating: null, rated_at: null, slot: null, note: null });
    const s = exportSummary({
      solves: [solve('a'), solve('a'), solve('b')],
      problems: [{ slug: 'a', difficulty: 'Easy', topic: 'Arrays' }, { slug: 'b', difficulty: 'Hard', topic: 'Graphs' }] as never,
      topicStates: [], applications: [], outreach: [], projects: [], commits: [], ideas: [],
    });
    expect(s.leetcode).toMatchObject({ solved: 2, submissions: 3, by_difficulty: { Easy: 1, Hard: 1 } });
  });
  it('names the file by date', () => {
    expect(exportFilename(NOW)).toBe('lock-in-export-2026-10-14.json');
  });
});
