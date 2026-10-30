import type {
  LearnCheck, LearnItem, LearnModule, LearnModuleState, LearnProgress, LearnStatus, LearnTrack, LearnType, Settings,
} from '../data/types';
import { LESSONS, lessonItemId, lessonStatus, type Lesson } from './lessons';
import { addDays, daysBetween } from './time';

export const TRACKS: { id: LearnTrack; label: string }[] = [{ id: 'cs', label: 'CS' }, { id: 'math', label: 'Math' }, { id: 'founder', label: 'Founder' }];
export const TYPE_ORDER: LearnType[] = ['watch', 'do', 'build', 'check'];
export const TYPE_LABEL: Record<LearnType, string> = { watch: 'Watch', do: 'Do', build: 'Build', check: 'Check' };
export const STATUS_LABEL: Record<LearnStatus, string> = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

/** Days between spaced reviews of a finished module. Nailed moves one step out, struggled repeats, needed help starts over. */
export const REVIEW_DAYS = [3, 7, 21, 60, 120];

export interface LearnData {
  modules: LearnModule[]; items: LearnItem[]; progress: LearnProgress[]; states: LearnModuleState[]; checks: LearnCheck[];
  /** The app's lessons (shared/lessons) unless given; tests pass their own. */
  lessons?: Lesson[];
}

export const statusOf = (progress: Map<string, LearnProgress>, itemId: string): LearnStatus => progress.get(itemId)?.status ?? 'not_started';
export const progressMap = (progress: LearnProgress[]) => new Map(progress.map((p) => [p.item_id, p]));

export type ModuleStatus = LearnStatus | 'review';

export interface LessonView { lesson: Lesson; status: LearnStatus }

/**
 * done / total / hours count the lessons when a module has them (the watch/do/build items are then optional
 * "go deeper" material), and the items otherwise.
 */
export interface ModuleView {
  module: LearnModule; items: LearnItem[]; lessons: LessonView[]; done: number; total: number; hours: number;
  status: ModuleStatus; doneOn: string | null; nextReview: string | null;
}

/** When the next spaced review is due for a finished module, or null if it isn't finished. */
export function nextReview(state: LearnModuleState | undefined, checks: LearnCheck[]): string | null {
  if (!state) return null;
  let step = 0;
  let last = state.done_on;
  const reviews = checks.filter((c) => c.module_id === state.module_id && c.kind === 'review' && c.taken_on >= state.done_on)
    .sort((a, b) => a.taken_on.localeCompare(b.taken_on));
  for (const r of reviews) {
    step = r.rating === 'nailed' ? Math.min(step + 1, REVIEW_DAYS.length - 1) : r.rating === 'help' ? 0 : step;
    last = r.taken_on;
  }
  return addDays(last, REVIEW_DAYS[step]);
}

export function moduleViews(d: LearnData, track: LearnTrack | null, today: string): ModuleView[] {
  const prog = progressMap(d.progress);
  const states = new Map(d.states.map((s) => [s.module_id, s]));
  return d.modules.filter((m) => !track || m.track === track).sort((a, b) => a.ord - b.ord).map((module) => {
    const items = d.items.filter((i) => i.module_id === module.id)
      .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.ord - b.ord);
    const lessons = (d.lessons ?? LESSONS).filter((l) => l.moduleId === module.id).map((lesson) => ({ lesson, status: lessonStatus(prog, lesson) }));
    const counted = lessons.length
      ? { done: lessons.filter((l) => l.status === 'done').length, total: lessons.length, hours: lessons.reduce((n, l) => n + l.lesson.minutes, 0) / 60 }
      : { done: items.filter((i) => statusOf(prog, i.id) === 'done').length, total: items.length, hours: items.reduce((n, i) => n + i.hours, 0) };
    const started = items.some((i) => statusOf(prog, i.id) !== 'not_started') || lessons.some((l) => l.status !== 'not_started');
    const state = states.get(module.id);
    const review = nextReview(state, d.checks);
    const status: ModuleStatus = state ? (review && review <= today ? 'review' : 'done') : started ? 'in_progress' : 'not_started';
    return { module, items, lessons, ...counted, status, doneOn: state?.done_on ?? null, nextReview: review };
  });
}

export const reviewsDue = (d: LearnData, today: string) =>
  moduleViews(d, null, today).filter((v) => v.status === 'review').sort((a, b) => (a.nextReview ?? '').localeCompare(b.nextReview ?? ''));

// ---- Daily split between interview prep and learning ----

export interface Split { total: number; prep: number; learn: number; learnPct: number }

/** Default 3 hours a day, 30% learning (70/30 in recruiting season). */
export function split(s: Pick<Settings, 'study_minutes' | 'learn_split'> | undefined): Split {
  const total = s?.study_minutes ?? 180;
  const learnPct = s?.learn_split ?? 30;
  const learn = Math.round((total * learnPct) / 100);
  return { total, prep: total - learn, learn, learnPct };
}

export const fmtMinutes = (m: number): string => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

// ---- What's next: one learning step for today ----

export type Next =
  | { kind: 'review'; view: ModuleView }
  | { kind: 'lesson'; lesson: Lesson; view: ModuleView; status: LearnStatus }
  | { kind: 'item'; item: LearnItem; view: ModuleView; status: LearnStatus; minutes: number; partial: boolean }
  | { kind: 'check'; view: ModuleView }
  | { kind: 'none' };

const TRACK_ORDER: LearnTrack[] = ['cs', 'math', 'founder'];

/**
 * A review that's due comes first (they're short). Then whatever's in progress, most recent first; then the next
 * step in the furthest-along module; then the first module not started, rotating tracks by day so all three move.
 * In a module with lessons, the next step is the next lesson, and the check once they're all done. Otherwise it's
 * the next item in watch → do → build → check order; one longer than today's learning time is marked partial.
 */
export function whatsNext(d: LearnData, today: string, learnMinutes: number): Next {
  const due = reviewsDue(d, today);
  if (due.length) return { kind: 'review', view: due[0] };
  const prog = progressMap(d.progress);
  const views = moduleViews(d, null, today);
  const byTrack = (v: ModuleView) => TRACK_ORDER.indexOf(v.module.track);
  const pick = (view: ModuleView, item: LearnItem): Next => {
    const minutes = Math.round(item.hours * 60);
    return { kind: 'item', item, view, status: statusOf(prog, item.id), minutes: Math.min(minutes, learnMinutes), partial: minutes > learnMinutes };
  };
  const started = d.progress.filter((p) => p.status === 'in_progress').sort((a, b) => (b.started_on ?? '').localeCompare(a.started_on ?? ''));
  const nextLesson = (view: ModuleView): Next | null => {
    const l = view.lessons.find((x) => x.status !== 'done');
    return l ? { kind: 'lesson', lesson: l.lesson, view, status: l.status } : null;
  };
  for (const p of started) {
    const view = views.find((v) => v.lessons.some((l) => lessonItemId(l.lesson) === p.item_id));
    const l = view?.lessons.find((x) => lessonItemId(x.lesson) === p.item_id);
    if (view && l && view.status === 'in_progress') return { kind: 'lesson', lesson: l.lesson, view, status: l.status };
  }
  for (const p of started) {
    const view = views.find((v) => v.items.some((i) => i.id === p.item_id));
    const item = view?.items.find((i) => i.id === p.item_id);
    if (view && item && view.status === 'in_progress' && !view.lessons.length) return pick(view, item);
  }
  const open = views.filter((v) => v.status === 'in_progress').sort((a, b) => b.done / b.total - a.done / a.total || byTrack(a) - byTrack(b));
  for (const view of open) {
    if (view.lessons.length) {
      const step = nextLesson(view);
      if (step) return step;
      return { kind: 'check', view }; // every lesson done: check it and mark the module done
    }
    const item = view.items.find((i) => statusOf(prog, i.id) === 'not_started');
    if (item) return item.type === 'check' ? { kind: 'check', view } : pick(view, item);
    if (view.done === view.total) return { kind: 'check', view }; // all done: check it and mark the module done
  }
  const fresh = views.filter((v) => v.status === 'not_started');
  if (fresh.length) {
    const offset = Math.abs(daysBetween('2026-01-01', today)) % TRACK_ORDER.length;
    const order = [...TRACK_ORDER.slice(offset), ...TRACK_ORDER.slice(0, offset)];
    const view = [...fresh].sort((a, b) => order.indexOf(a.module.track) - order.indexOf(b.module.track) || a.module.ord - b.module.ord)[0];
    return nextLesson(view) ?? pick(view, view.items[0]);
  }
  return { kind: 'none' };
}
