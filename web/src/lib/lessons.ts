/**
 * Interactive lessons (Grind → a track → a module → Lessons): short reads with a Python exercise graded in the
 * browser. Content lives in shared/lessons/<module>/<NN-slug>/ and ships with the app; CI (worker/tests/
 * test_lessons.py) proves every solution passes and every starter fails, using the same grader as the browser.
 * Progress is a learn_progress row with item_id "lesson:<module>/<slug>", so finishing one counts for the day.
 */
import type { LearnProgress, LearnStatus, Rating } from '../data/types';

export interface QuizOption { text: string; correct: boolean; why: string }
/** Multiple choice: every option explains itself. */
export interface ChoiceQuestion { q: string; options: QuizOption[] }
/** Recall: type the answer; any of `answer` counts (see answerMatches). */
export interface AnswerQuestion { q: string; answer: string[]; why: string }
export type Question = ChoiceQuestion | AnswerQuestion;
/** quiz: quick checks placed in the reading (<!-- check N --> in lesson.md). review: spaced-review questions. */
export interface LessonMeta { title: string; minutes: number; task: string; hints: string[]; quiz: Question[]; review: Question[] }

export const isChoice = (q: Question): q is ChoiceQuestion => 'options' in q;

/**
 * The options in a fixed but scrambled order, seeded by the question's text: stable across reloads, so the
 * right answer doesn't move while you think, but never "always the first one".
 */
export function shuffledOptions<T>(options: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const out = [...options];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Forgiving about case, spaces, quotes and backticks; numbers compare by value ("0x0F" isn't special, "15.0" is 15). */
export function answerMatches(given: string, accepted: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s`'"]/g, '');
  const num = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null);
  const g = norm(given);
  if (!g) return false;
  return accepted.some((a) => {
    const n = norm(a);
    return n === g || (num(n) !== null && num(n) === num(g));
  });
}

/** lesson.md split at its quick checks: text, then the check number that follows it (null after the last part). */
export function splitReading(md: string): { text: string; check: number | null }[] {
  const parts: { text: string; check: number | null }[] = [];
  let rest = md;
  const re = /^<!-- check (\d+) -->$/m;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    parts.push({ text: rest.slice(0, m.index), check: Number(m[1]) });
    rest = rest.slice(m.index + m[0].length);
  }
  parts.push({ text: rest, check: null });
  return parts.filter((p) => p.text.trim() || p.check !== null);
}
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

export const loadLessonMeta = (l: Lesson): Promise<LessonMeta> =>
  metas[`${ROOT}${l.id}/lesson.json`]().then((raw) => JSON.parse(raw) as LessonMeta);

export async function loadLessonFiles(l: Lesson): Promise<LessonFiles> {
  const read = (name: string) => texts[`${ROOT}${l.id}/${name}`]?.() ?? Promise.resolve('');
  const [meta, [md, starter, solution, tests, prelude]] = await Promise.all([
    loadLessonMeta(l),
    Promise.all(['lesson.md', 'starter.py', 'solution.py', 'tests.py', 'prelude.py'].map(read)),
  ]);
  return { meta, md, starter, solution, tests, prelude };
}

export const lessonStatus = (progress: Map<string, LearnProgress>, l: Lesson): LearnStatus =>
  progress.get(lessonItemId(l))?.status ?? 'not_started';

/** Passing on your own is nailed it; with hints, struggled; after looking at the solution, needed help. */
export const lessonRating = (hintsUsed: number, sawSolution: boolean, asked = false): Rating =>
  sawSolution ? 'help' : hintsUsed > 0 || asked ? 'struggled' : 'nailed';

/** Ask Claude sends at most this much code (the Mac launcher refuses more). */
export const ASK_CODE_MAX = 20_000;

// ---- Per-lesson scratch state on this computer: your code, and which hints you've opened ----

/** asked: pressed Ask Claude. Like a hint, it makes a pass "struggled". */
export interface Draft { code: string | null; hints: number; sawSolution: boolean; asked: boolean }
const draftKey = (l: Pick<Lesson, 'id'>) => `lockin.lesson.${l.id}`;

export function readDraft(l: Pick<Lesson, 'id'>): Draft {
  try {
    const raw = localStorage.getItem(draftKey(l));
    const d = raw ? JSON.parse(raw) : {};
    return { code: typeof d.code === 'string' ? d.code : null, hints: Number(d.hints) || 0, sawSolution: d.sawSolution === true, asked: d.asked === true };
  } catch {
    return { code: null, hints: 0, sawSolution: false, asked: false };
  }
}

export function writeDraft(l: Pick<Lesson, 'id'>, d: Draft) {
  try {
    localStorage.setItem(draftKey(l), JSON.stringify(d));
  } catch {
    // private window or storage full: the draft just won't survive a reload
  }
}
