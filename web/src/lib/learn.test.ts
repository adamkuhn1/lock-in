import { describe, expect, it } from 'vitest';
import type { LearnCheck, LearnItem, LearnModule, LearnProgress } from '../data/types';
import { fmtMinutes, moduleViews, nextReview, reviewsDue, split, whatsNext, type LearnData } from './learn';

const M = (id: string, track: LearnModule['track'], ord: number): LearnModule => ({ id, track, ord, title: id, summary: '' });
const I = (id: string, module_id: string, type: LearnItem['type'], hours = 1, ord = 1): LearnItem =>
  ({ id, module_id, ord, type, title: id, url: null, hours, project: null, check_kind: type === 'check' ? 'quiz' : null, details: '' });
const P = (item_id: string, status: LearnProgress['status'], started_on: string | null = '2026-10-01'): LearnProgress =>
  ({ item_id, status, rating: null, notes: '', started_on, done_on: status === 'done' ? '2026-10-02' : null });
const R = (module_id: string, taken_on: string, rating: LearnCheck['rating']): LearnCheck =>
  ({ id: taken_on, module_id, kind: 'review', score: 2, total: 3, rating, summary: '', taken_on });

const base = (): LearnData => ({
  modules: [M('cs-1', 'cs', 1), M('cs-2', 'cs', 2), M('math-1', 'math', 1), M('founder-1', 'founder', 1)],
  items: ['cs-1', 'cs-2', 'math-1', 'founder-1'].flatMap((m) => [
    I(`${m}-c`, m, 'check', 0.5, 4), I(`${m}-b`, m, 'build', 10, 3), I(`${m}-w`, m, 'watch', 2, 1), I(`${m}-d`, m, 'do', 1, 2)]),
  progress: [], states: [], checks: [],
});

describe('module views', () => {
  it('orders items watch, do, build, check and derives status', () => {
    const d = base();
    d.progress = [P('cs-1-w', 'done')];
    d.states = [{ module_id: 'math-1', done_on: '2026-10-20' }];
    const views = moduleViews(d, null, '2026-10-21');
    expect(views.find((v) => v.module.id === 'cs-1')!.items.map((i) => i.type)).toEqual(['watch', 'do', 'build', 'check']);
    expect(views.map((v) => [v.module.id, v.status])).toEqual([['cs-1', 'in_progress'], ['math-1', 'done'], ['founder-1', 'not_started'], ['cs-2', 'not_started']]);
    expect(moduleViews(d, 'cs', '2026-10-21').map((v) => v.module.id)).toEqual(['cs-1', 'cs-2']);
    expect(moduleViews(d, 'cs', '2026-10-21')[0]).toMatchObject({ done: 1, total: 4, hours: 13.5 });
  });
});

describe('spaced reviews', () => {
  const state = { module_id: 'm', done_on: '2026-10-01' };
  it('3, 7, 21 days on nailed reviews; struggled repeats; help starts over', () => {
    expect(nextReview(state, [])).toBe('2026-10-04');
    expect(nextReview(state, [R('m', '2026-10-04', 'nailed')])).toBe('2026-10-11');
    expect(nextReview(state, [R('m', '2026-10-04', 'nailed'), R('m', '2026-10-11', 'nailed')])).toBe('2026-11-01');
    expect(nextReview(state, [R('m', '2026-10-04', 'nailed'), R('m', '2026-10-11', 'struggled')])).toBe('2026-10-18');
    expect(nextReview(state, [R('m', '2026-10-04', 'nailed'), R('m', '2026-10-11', 'help')])).toBe('2026-10-14');
    expect(nextReview(undefined, [])).toBeNull();
  });
  it('a finished module comes back as review when due', () => {
    const d = base();
    d.states = [{ module_id: 'math-1', done_on: '2026-10-01' }];
    expect(reviewsDue(d, '2026-10-03')).toHaveLength(0);
    expect(reviewsDue(d, '2026-10-04').map((v) => v.module.id)).toEqual(['math-1']);
  });
});

describe('time split', () => {
  it('defaults to 3 hours, 70/30', () => {
    expect(split(undefined)).toEqual({ total: 180, prep: 126, learn: 54, learnPct: 30 });
    expect(split({ study_minutes: 240, learn_split: 50 })).toEqual({ total: 240, prep: 120, learn: 120, learnPct: 50 });
    expect([fmtMinutes(54), fmtMinutes(126), fmtMinutes(120)]).toEqual(['54 min', '2 h 6 min', '2 h']);
  });
});

describe("what's next", () => {
  it('a due review comes first', () => {
    const d = base();
    d.states = [{ module_id: 'math-1', done_on: '2026-10-01' }];
    d.progress = [P('cs-1-w', 'in_progress')];
    expect(whatsNext(d, '2026-10-10', 54)).toMatchObject({ kind: 'review', view: { module: { id: 'math-1' } } });
  });
  it('then the most recent item in progress, then the next item in a started module', () => {
    const d = base();
    d.progress = [P('cs-1-w', 'in_progress', '2026-10-01'), P('math-1-w', 'in_progress', '2026-10-05')];
    expect(whatsNext(d, '2026-10-10', 54)).toMatchObject({ kind: 'item', item: { id: 'math-1-w' }, status: 'in_progress', minutes: 54, partial: true });
    d.progress = [P('cs-1-w', 'done')];
    expect(whatsNext(d, '2026-10-10', 90)).toMatchObject({ kind: 'item', item: { id: 'cs-1-d' }, minutes: 60, partial: false });
  });
  it('suggests the check when only the check is left, and a fresh module when nothing is started', () => {
    const d = base();
    d.progress = ['w', 'd', 'b'].map((t) => P(`cs-1-${t}`, 'done'));
    expect(whatsNext(d, '2026-10-10', 54)).toMatchObject({ kind: 'check', view: { module: { id: 'cs-1' } } });
    const fresh = whatsNext(base(), '2026-10-10', 54);
    expect(fresh.kind === 'item' && fresh.item.type).toBe('watch');
  });
  it('none when everything is done and nothing is due', () => {
    const d = base();
    d.states = d.modules.map((m) => ({ module_id: m.id, done_on: '2026-10-09' }));
    expect(whatsNext(d, '2026-10-10', 54)).toEqual({ kind: 'none' });
  });
});
