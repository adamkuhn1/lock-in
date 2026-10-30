import { describe, expect, it } from 'vitest';
import learning from '../../../shared/learning.json';
import { LESSONS, findLesson, lessonItemId, lessonPath, lessonRating, lessonsFor, loadLessonFiles, readDraft, writeDraft } from './lessons';

describe('lessons', () => {
  it('load from shared/lessons, in order, each in a real module', () => {
    const modules = new Set(learning.tracks.flatMap((t) => t.modules.map((m) => m.id)));
    expect(LESSONS.length).toBeGreaterThan(0);
    for (const l of LESSONS) {
      expect(modules.has(l.moduleId)).toBe(true);
      expect(l.id).toBe(`${l.moduleId}/${l.slug}`);
      expect(l.title.length).toBeGreaterThan(0);
    }
    const cs1 = lessonsFor('cs-1');
    expect(cs1[0]).toMatchObject({ slug: '01-binary', ord: 1 });
    expect(cs1.map((l) => l.ord)).toEqual([...cs1.map((l) => l.ord)].sort((a, b) => a - b));
  });

  it('read their files on demand', async () => {
    const f = await loadLessonFiles(findLesson('cs-1', '01-binary')!);
    expect(f.md).toContain('Place value');
    expect(f.starter).toContain('def to_binary');
    expect(f.solution).toContain('def from_binary');
    expect(f.tests).toContain('def test_');
    expect(f.prelude).toBe('');
    expect(f.meta).toMatchObject({ title: 'Bits: counting with two digits', hints: expect.any(Array), quiz: expect.any(Array) });
  });

  it('ids, paths and ratings', () => {
    const l = findLesson('cs-1', '01-binary')!;
    expect(lessonItemId(l)).toBe('lesson:cs-1/01-binary');
    expect(lessonPath('cs', l)).toBe('/grind/learn/cs/cs-1/01-binary');
    expect([lessonRating(0, false), lessonRating(2, false), lessonRating(0, true)]).toEqual(['nailed', 'struggled', 'help']);
    expect(findLesson('cs-1', 'nope')).toBeUndefined();
  });

  it('keep a draft per lesson, and survive bad storage', () => {
    const l = { id: 'test/01-x' };
    expect(readDraft(l)).toEqual({ code: null, hints: 0, sawSolution: false });
    writeDraft(l, { code: 'x = 1', hints: 2, sawSolution: true });
    expect(readDraft(l)).toEqual({ code: 'x = 1', hints: 2, sawSolution: true });
    localStorage.setItem('lockin.lesson.test/01-x', '{not json');
    expect(readDraft(l)).toEqual({ code: null, hints: 0, sawSolution: false });
  });
});
