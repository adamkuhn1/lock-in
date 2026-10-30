/**
 * Interactive lessons (Grind → a track → a module → Lessons): short reads with a Python exercise graded in the
 * browser. Content lives in shared/lessons/<module>/<NN-slug>/ and ships with the app; CI (worker/tests/
 * test_lessons.py) proves every solution passes and every starter fails, using the same grader as the browser.
 * Progress is a learn_progress row with item_id "lesson:<module>/<slug>", so finishing one counts for the day.
 */
import type { LearnProgress, LearnStatus, Rating } from '../data/types';

export interface QuizOption { text: string; correct: boolean; why: string }
export interface QuizQuestion { q: string; options: QuizOption[] }
export interface LessonMeta { title: string; minutes: number; task: string; hints: string[]; quiz?: QuizQuestion[] }
/** What every screen needs up front; the rest of lesson.json (task, hints, quiz) loads with the lesson. */
export interface Lesson { id: string; moduleId: string; slug: string; ord: number; title: string; minutes: number }
export interface LessonFiles { meta: LessonMeta; md: string; starter: string; solution: string; tests: string; prelude: string }

const ROOT = '../../../shared/lessons/';
// Only title and minutes are bundled with the app (JSON named exports), so 100+ lessons stay cheap.
const titles = import.meta.glob('../../../shared/lessons/*/*/lesson.json', { eager: true, import: 'title' }) as Record<string, string>;
const minutes = import.meta.glob('../../../shared/lessons/*/*/lesson.json', { eager: true, import: 'minutes' }) as Record<string, number>;
// The full lesson.json loads as text: importing the same JSON module eagerly and lazily would bundle all of it.
const metas = import.meta.glob('../../../shared/lessons/*/*/lesson.json', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const texts = import.meta.glob('../../../shared/lessons/*/*/*.{md,py}', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export const LESSONS: Lesson[] = Object.keys(titles)
  .map((path) => {
    const [moduleId, slug] = path.slice(ROOT.length).split('/');
    return { id: `${moduleId}/${slug}`, moduleId, slug, ord: Number(slug.slice(0, 2)), title: titles[path], minutes: minutes[path] };
  })
  .sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.ord - b.ord);

export const lessonsFor = (moduleId: string) => LESSONS.filter((l) => l.moduleId === moduleId);
export const findLesson = (moduleId: string, slug: string) => LESSONS.find((l) => l.moduleId === moduleId && l.slug === slug);
export const lessonItemId = (l: Pick<Lesson, 'id'>) => `lesson:${l.id}`;
export const lessonPath = (track: string, l: Pick<Lesson, 'moduleId' | 'slug'>) => `/grind/learn/${track}/${l.moduleId}/${l.slug}`;

export async function loadLessonFiles(l: Lesson): Promise<LessonFiles> {
  const read = (name: string) => texts[`${ROOT}${l.id}/${name}`]?.() ?? Promise.resolve('');
  const [meta, [md, starter, solution, tests, prelude]] = await Promise.all([
    metas[`${ROOT}${l.id}/lesson.json`]().then((raw) => JSON.parse(raw) as LessonMeta),
    Promise.all(['lesson.md', 'starter.py', 'solution.py', 'tests.py', 'prelude.py'].map(read)),
  ]);
  return { meta, md, starter, solution, tests, prelude };
}

export const lessonStatus = (progress: Map<string, LearnProgress>, l: Lesson): LearnStatus =>
  progress.get(lessonItemId(l))?.status ?? 'not_started';

/** Passing on your own is nailed it; with hints, struggled; after looking at the solution, needed help. */
export const lessonRating = (hintsUsed: number, sawSolution: boolean): Rating =>
  sawSolution ? 'help' : hintsUsed > 0 ? 'struggled' : 'nailed';

// ---- Per-lesson scratch state on this computer: your code, and which hints you've opened ----

export interface Draft { code: string | null; hints: number; sawSolution: boolean }
const draftKey = (l: Pick<Lesson, 'id'>) => `lockin.lesson.${l.id}`;

export function readDraft(l: Pick<Lesson, 'id'>): Draft {
  try {
    const raw = localStorage.getItem(draftKey(l));
    const d = raw ? JSON.parse(raw) : {};
    return { code: typeof d.code === 'string' ? d.code : null, hints: Number(d.hints) || 0, sawSolution: d.sawSolution === true };
  } catch {
    return { code: null, hints: 0, sawSolution: false };
  }
}

export function writeDraft(l: Pick<Lesson, 'id'>, d: Draft) {
  try {
    localStorage.setItem(draftKey(l), JSON.stringify(d));
  } catch {
    // private window or storage full: the draft just won't survive a reload
  }
}
