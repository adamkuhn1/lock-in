/**
 * Topic mastery, computed from solves so the map moves the moment a rating is saved.
 * Same rules as worker/lockin_worker/levels.py (both read shared/mastery.json and pass shared/mastery_cases.json).
 */
import rules from '../../../shared/mastery.json';
import roadmap from '../../../shared/roadmap.json';
import type { Difficulty, LcRating, Level, Problem, Slot, Solve, Topic } from '../data/types';
import { planDay } from './time';

export interface Pools { easy: number; medium: number; hard: number }
export interface Attempt { slug: string; difficulty: Difficulty; rating: LcRating; on: string; slot: Slot }
export interface Progress {
  easyCleared: number;
  easyTotal: number;
  firstTries: LcRating[]; // first attempt at each Medium, oldest first
  mediumSolo: number;
  hardsTried: number;
  hardTotal: number;
}

export const LEVELS: Level[] = ['locked', 'available', 'learning', 'practicing', 'solid', 'mastered'];
export const LEVEL_LABEL: Record<Level, string> = {
  locked: 'Locked', available: 'Ready', learning: 'Learning', practicing: 'Practicing', solid: 'Solid', mastered: 'Mastered',
};
const rank = (l: Level) => LEVELS.indexOf(l);
const EASY_COUNTS = new Set<string>(rules.easyCounts);

export function progress(attempts: Attempt[], pools: Pools): Progress {
  const sorted = [...attempts].sort((a, b) => a.on.localeCompare(b.on) || Number(a.slot !== 'new') - Number(b.slot !== 'new'));
  const easy = new Set(sorted.filter((x) => x.difficulty === 'Easy' && EASY_COUNTS.has(x.rating)).map((x) => x.slug));
  const first = new Map<string, LcRating>();
  for (const x of sorted) if (x.difficulty === 'Medium' && !first.has(x.slug)) first.set(x.slug, x.rating);
  const solo = new Set(sorted.filter((x) => x.difficulty === 'Medium' && x.rating === 'solo').map((x) => x.slug));
  const hards = new Set(sorted.filter((x) => x.difficulty === 'Hard').map((x) => x.slug));
  return {
    easyCleared: Math.min(easy.size, pools.easy), easyTotal: pools.easy, firstTries: [...first.values()],
    mediumSolo: solo.size, hardsTried: Math.min(hards.size, pools.hard), hardTotal: pools.hard,
  };
}

interface WindowRule { window: number; firstTrySolo: number }
/** The last-N-new-Mediums bar, shrunk proportionally for topics with fewer Mediums than the window. */
export function windowNeed(rule: WindowRule, mediumPool: number) {
  const window = Math.min(rule.window, mediumPool);
  return { window, need: window === 0 ? 0 : Math.ceil((rule.firstTrySolo * window) / rule.window) };
}
function windowOk(p: Progress, rule: WindowRule, mediumPool: number): boolean {
  const { window, need } = windowNeed(rule, mediumPool);
  if (window === 0) return true;
  const recent = p.firstTries.slice(-window);
  return recent.length === window && recent.filter((r) => r === 'solo').length >= need;
}

export function levelFrom(p: Progress, pools: Pools, hasAttempts: boolean, prereqLevels: Level[]): Level {
  if (!hasAttempts) return prereqLevels.some((l) => rank(l) < rank('practicing')) ? 'locked' : 'available';
  const { practicing: pr, solid: so, mastered: ma } = rules;
  if (!(p.easyCleared >= Math.min(pr.easy, pools.easy) && p.mediumSolo >= Math.min(pr.mediumSolo, pools.medium))) return 'learning';
  if (!(p.easyCleared >= Math.ceil(so.easyShare * pools.easy) && windowOk(p, so, pools.medium))) return 'practicing';
  if (!(p.easyCleared >= Math.ceil(ma.easyShare * pools.easy) && windowOk(p, ma, pools.medium)
    && p.hardsTried >= Math.min(ma.hards, pools.hard))) return 'solid';
  return 'mastered';
}

export function poolsFor(problems: Iterable<Problem>, topic: string): Pools {
  const out = { easy: 0, medium: 0, hard: 0 };
  for (const p of problems) {
    if (p.topic !== topic || p.paid_only) continue;
    out[p.difficulty.toLowerCase() as keyof Pools] += 1;
  }
  return out;
}

/**
 * One attempt per problem per plan day, as the worker counts them. A solve the worker applied carries its
 * effective rating; one rated today but not yet applied counts with its rating; unrated ones today are still pending.
 */
export function attemptsByTopic(solves: Solve[], problems: Map<string, Problem>): Map<string, Attempt[]> {
  const groups = new Map<string, Solve[]>();
  for (const s of [...solves].sort((a, b) => Date.parse(a.accepted_at) - Date.parse(b.accepted_at))) {
    const key = `${s.slug}|${planDay(new Date(s.accepted_at))}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out = new Map<string, Attempt[]>();
  for (const [key, rows] of groups) {
    const p = problems.get(rows[0].slug);
    if (!p) continue;
    const rating = rows.find((r) => r.effective_rating)?.effective_rating ?? rows.find((r) => r.rating)?.rating ?? null;
    if (!rating) continue;
    const on = key.split('|')[1];
    const slot = rows.find((r) => r.slot)?.slot ?? 'new';
    out.set(p.topic, [...(out.get(p.topic) ?? []), { slug: p.slug, difficulty: p.difficulty, rating, on, slot }]);
  }
  return out;
}

/** One line of what a topic needs for its next level. */
export interface Requirement {
  kind: 'easy' | 'mediumSolo' | 'window' | 'hard';
  have: number;
  need: number;
  met: boolean;
  text: string;
  window?: number; // kind 'window': how many recent first tries count
}
export interface Step { target: Level | null; reqs: Requirement[] }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function nextStep(level: Level, p: Progress, pools: Pools): Step {
  const { practicing: pr, solid: so, mastered: ma } = rules;
  const easy = (need: number): Requirement => ({
    kind: 'easy', have: p.easyCleared, need, met: p.easyCleared >= need,
    text: need === pools.easy ? `Clear every Easy (${pools.easy})` : `Clear ${plural(need, 'Easy', 'Easies')}`,
  });
  const win = (rule: WindowRule): Requirement => {
    const { window, need } = windowNeed(rule, pools.medium);
    const recent = p.firstTries.slice(-window);
    const have = recent.filter((r) => r === 'solo').length;
    return { kind: 'window', have, need, window, met: recent.length === window && have >= need,
      text: `Solve ${need} of your last ${window} new Mediums on your own` };
  };
  if (rank(level) <= rank('learning')) {
    const need = Math.min(pr.mediumSolo, pools.medium);
    return { target: 'practicing', reqs: [easy(Math.min(pr.easy, pools.easy)), {
      kind: 'mediumSolo' as const, have: p.mediumSolo, need, met: p.mediumSolo >= need, text: `Solve ${plural(need, 'Medium')} on your own`,
    }].filter((r) => r.need > 0) };
  }
  const hardNeed = Math.min(ma.hards, pools.hard);
  const hard: Requirement = { kind: 'hard', have: p.hardsTried, need: hardNeed, met: p.hardsTried >= hardNeed,
    text: `Work through ${plural(hardNeed, 'Hard')} (help is fine)` };
  if (level === 'practicing') return { target: 'solid', reqs: [easy(Math.ceil(so.easyShare * pools.easy)), win(so)].filter((r) => r.need > 0) };
  const reqs = [easy(Math.ceil(ma.easyShare * pools.easy)), win(ma), hard].filter((r) => r.need > 0);
  return { target: level === 'solid' ? 'mastered' : null, reqs };
}

/** How far along the road to Mastered, 0..1, for the bar on the map. */
export function masteryShare(level: Level, p: Progress, pools: Pools): number {
  if (level === 'mastered') return 1;
  const { window, need } = windowNeed(rules.mastered, pools.medium);
  const solo = p.firstTries.slice(-window).filter((r) => r === 'solo').length;
  const parts: [number, number][] = [
    [pools.easy ? p.easyCleared / pools.easy : 1, 0.4],
    [need ? Math.min(solo / need, 1) : 1, 0.45],
    [pools.hard ? Math.min(p.hardsTried / Math.min(rules.mastered.hards, pools.hard), 1) : 1, 0.15],
  ];
  return Math.min(parts.reduce((s, [v, w]) => s + v * w, 0), 0.99);
}

export interface MapTopic {
  name: string;
  short: string;
  x: number;
  y: number;
  prereqs: string[];
  level: Level;
  progress: Progress;
  pools: Pools;
  share: number;
  isFocus: boolean;
  lessons: { name: string; url: string }[];
}

const SHORT: Record<string, string> = {
  'Heap / Priority Queue': 'Heap / PQ', '1-D Dynamic Programming': '1-D DP', '2-D Dynamic Programming': '2-D DP',
  'Bit Manipulation': 'Bit Manip', 'Math & Geometry': 'Math & Geo', 'Advanced Graphs': 'Adv. Graphs',
};
const LAYOUT = new Map(roadmap.topics.map((t) => [t.topic, t]));

/** The roadmap with every topic's level and progress, in roadmap order (prerequisites first). */
export function buildMap(topics: Topic[], solves: Solve[], problems: Map<string, Problem>, focus: string | null): MapTopic[] {
  const attempts = attemptsByTopic(solves, problems);
  const levels = new Map<string, Level>();
  return [...topics].sort((a, b) => a.ord - b.ord).map((t) => {
    const pools = poolsFor(problems.values(), t.name);
    const mine = attempts.get(t.name) ?? [];
    const prog = progress(mine, pools);
    const level = levelFrom(prog, pools, mine.length > 0, t.prereqs.map((x) => levels.get(x) ?? 'locked'));
    levels.set(t.name, level);
    const lay = LAYOUT.get(t.name);
    return {
      name: t.name, short: SHORT[t.name] ?? t.name, x: lay?.position.x ?? 0, y: lay?.position.y ?? t.tier * 200,
      prereqs: t.prereqs, level, progress: prog, pools, share: masteryShare(level, prog, pools), isFocus: t.name === focus,
      lessons: (lay?.neetcodeLessons ?? []).map((l) => ({ name: l.name, url: `https://neetcode.io${l.routerLink}` })),
    };
  });
}
