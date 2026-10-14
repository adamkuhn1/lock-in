import type { Commit, Idea, LaunchRequest } from '../data/types';
import { addDays, localDay, planDay } from './time';

const byPosition = (a: Idea, b: Idea) => a.position - b.position || a.created_at.localeCompare(b.created_at);

export function visibleIdeas(ideas: Idea[], projectId: string): Idea[] {
  return ideas.filter((i) => i.project_id === projectId && (i.status === 'todo' || i.status === 'today' || i.status === 'in_progress')).sort(byPosition);
}

export function doneIdeas(ideas: Idea[], projectId: string): Idea[] {
  return ideas.filter((i) => i.project_id === projectId && i.status === 'done').sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
}

export function moveIdea(list: Idea[], id: string, dir: -1 | 1): { id: string; position: number }[] {
  const order = [...list];
  const i = order.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [];
  [order[i], order[j]] = [order[j], order[i]];
  return order.flatMap((x, pos) => (x.position === pos ? [] : [{ id: x.id, position: pos }]));
}

export const nextPosition = (list: Idea[]) => list.reduce((m, i) => Math.max(m, i.position + 1), 0);

export function todaysIdea(ideas: Idea[], day: string): Idea | null {
  return ideas.find((i) => i.today_on === day && (i.status === 'today' || i.status === 'done')) ?? null;
}

export function swapCandidate(ideas: Idea[], current: Idea): Idea | null {
  const todo = ideas.filter((i) => i.status === 'todo' && i.id !== current.id).sort(byPosition);
  return todo.find((i) => i.project_id === current.project_id) ?? todo[0] ?? null;
}

export function commitStrip(commits: Commit[], projectId: string, today: string, days = 30): number[] {
  const counts = new Map<string, number>();
  for (const c of commits) {
    if (c.project_id !== projectId) continue;
    const d = localDay(new Date(c.committed_at));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => counts.get(addDays(today, i - days + 1)) ?? 0);
}

/** Matches the worker's complete_idea_on_commit: a commit counts for the plan day (4 AM boundary). */
export function committedOnPlanDay(commits: Commit[], projectId: string, day: string): boolean {
  return commits.some((c) => c.project_id === projectId && planDay(new Date(c.committed_at)) === day);
}

/** "Opened on Mac" is only news for a while; after this the card goes back to idle. */
export const LAUNCHED_FRESH_MS = 3_600_000;

export type LaunchState = { kind: 'idle' } | { kind: 'queued' } | { kind: 'launched' } | { kind: 'failed'; error: string };

export function launchState(requests: LaunchRequest[], match: (r: LaunchRequest) => boolean, now: Date = new Date()): LaunchState {
  const r = requests.filter(match).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!r) return { kind: 'idle' };
  if (r.status === 'queued') return { kind: 'queued' };
  if (r.status === 'launched') return now.getTime() - Date.parse(r.created_at) <= LAUNCHED_FRESH_MS ? { kind: 'launched' } : { kind: 'idle' };
  return { kind: 'failed', error: r.error ?? 'Unknown error' };
}
export const suggestState = (requests: LaunchRequest[], projectId: string, now: Date = new Date()) =>
  launchState(requests, (r) => r.kind === 'suggest_ideas' && r.payload.project_id === projectId, now);
export const workState = (requests: LaunchRequest[], ideaId: string, now: Date = new Date()) =>
  launchState(requests, (r) => r.kind === 'work_on_idea' && r.payload.idea_id === ideaId, now);
export const mockState = (requests: LaunchRequest[], now: Date = new Date()) =>
  launchState(requests, (r) => r.kind === 'mock_interview', now);
