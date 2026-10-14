import { describe, expect, it } from 'vitest';
import type { Commit, Idea, LaunchRequest } from '../data/types';
import { commitStrip, committedOnPlanDay, doneIdeas, moveIdea, nextPosition, suggestState, swapCandidate, todaysIdea, visibleIdeas } from './ideas';

const I = (id: string, over: Partial<Idea> = {}): Idea => ({
  id, project_id: '27b', text: id, size: 'S', status: 'todo', source: 'me', position: 0, today_on: null,
  done_at: null, created_at: '2026-10-01T00:00:00Z', ...over,
});

describe('ideas', () => {
  const list = [I('c', { position: 2 }), I('a', { position: 0 }), I('b', { position: 1 }), I('x', { status: 'done' }), I('d', { status: 'dropped' }), I('o', { project_id: 'showboat' })];
  it('visible = todo/today for the project, by position', () => {
    expect(visibleIdeas(list, '27b').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(doneIdeas(list, '27b').map((i) => i.id)).toEqual(['x']);
  });
  it('moveIdea renumbers and returns only changed rows', () => {
    const vis = visibleIdeas(list, '27b');
    expect(moveIdea(vis, 'c', -1)).toEqual([{ id: 'c', position: 1 }, { id: 'b', position: 2 }]);
    expect(moveIdea(vis, 'a', -1)).toEqual([]);
    expect(moveIdea(vis, 'c', 1)).toEqual([]);
  });
  it('moveIdea fixes duplicate positions', () => {
    const dup = [I('a', { position: 0 }), I('b', { position: 0 }), I('c', { position: 0 })];
    expect(moveIdea(dup, 'a', 1)).toEqual([{ id: 'a', position: 1 }, { id: 'c', position: 2 }]); // b stays 0
  });
  it('nextPosition', () => {
    expect(nextPosition(visibleIdeas(list, '27b'))).toBe(3);
    expect(nextPosition([])).toBe(0);
  });
  it("today's idea includes one already done today", () => {
    expect(todaysIdea([I('t', { status: 'today', today_on: '2026-10-14' })], '2026-10-14')?.id).toBe('t');
    expect(todaysIdea([I('t', { status: 'done', today_on: '2026-10-14' })], '2026-10-14')?.id).toBe('t');
    expect(todaysIdea([I('t', { status: 'today', today_on: '2026-10-13' })], '2026-10-14')).toBeNull();
  });
  it('swapCandidate prefers the same project, else any todo', () => {
    const cur = I('t', { status: 'today' });
    expect(swapCandidate([cur, I('o', { project_id: 'showboat' }), I('n', { position: 5 })], cur)?.id).toBe('n');
    expect(swapCandidate([cur, I('o', { project_id: 'showboat' })], cur)?.id).toBe('o');
    expect(swapCandidate([cur], cur)).toBeNull();
  });
  it('commitStrip counts per local day, oldest first', () => {
    const commits = [
      { sha: '1', project_id: '27b', message: 'm', committed_at: '2026-10-14T18:00:00Z' },
      { sha: '2', project_id: '27b', message: 'm', committed_at: '2026-10-15T03:00:00Z' }, // 23:00 EDT Oct 14
      { sha: '3', project_id: '27b', message: 'm', committed_at: '2026-10-12T18:00:00Z' },
      { sha: '4', project_id: 'showboat', message: 'm', committed_at: '2026-10-14T18:00:00Z' },
    ] as Commit[];
    const strip = commitStrip(commits, '27b', '2026-10-14', 5);
    expect(strip).toEqual([0, 0, 1, 0, 2]);
  });
  it('committedOnPlanDay uses the 4 AM plan day (I2)', () => {
    const C = (committed_at: string, project_id = '27b') => ({ sha: committed_at, project_id, message: 'm', committed_at }) as Commit;
    // 01:30 EDT Oct 15 is still plan day Oct 14.
    expect(committedOnPlanDay([C('2026-10-15T05:30:00Z')], '27b', '2026-10-14')).toBe(true);
    expect(committedOnPlanDay([C('2026-10-15T05:30:00Z')], '27b', '2026-10-15')).toBe(false);
    expect(committedOnPlanDay([C('2026-10-15T09:00:00Z')], '27b', '2026-10-15')).toBe(true);
    expect(committedOnPlanDay([C('2026-10-14T18:00:00Z', 'showboat')], '27b', '2026-10-14')).toBe(false);
  });
  it('suggestState: Opened on Mac only within an hour of the request (M12)', () => {
    const R = (created_at: string): LaunchRequest => ({
      id: created_at, kind: 'suggest_ideas', payload: { project_id: '27b' }, status: 'launched', error: null, created_at,
    });
    const now = new Date('2026-10-14T13:00:00Z');
    expect(suggestState([R('2026-10-14T12:01:00Z')], '27b', now)).toEqual({ kind: 'launched' });
    expect(suggestState([R('2026-10-14T11:59:00Z')], '27b', now)).toEqual({ kind: 'idle' });
  });
  it('suggestState', () => {
    const R = (status: LaunchRequest['status'], created_at: string, error: string | null = null): LaunchRequest => ({
      id: created_at, kind: 'suggest_ideas', payload: { project_id: '27b' }, status, error, created_at,
    });
    expect(suggestState([], '27b')).toEqual({ kind: 'idle' });
    expect(suggestState([R('queued', '2026-10-14T12:00:00Z')], '27b')).toEqual({ kind: 'queued' });
    expect(suggestState([R('failed', '2026-10-14T12:00:00Z', 'no folder')], '27b')).toEqual({ kind: 'failed', error: 'no folder' });
    expect(suggestState([R('launched', '2026-10-14T12:00:00Z')], '27b', new Date('2026-10-14T12:30:00Z'))).toEqual({ kind: 'launched' });
    expect(suggestState([R('queued', '2026-10-14T12:00:00Z')], 'showboat')).toEqual({ kind: 'idle' });
  });
});
