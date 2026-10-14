import { STORY_TAGS, type Application, type CompanyPrep, type PrepKind, type PrepSession, type PrepStatus, type Stage, type Story, type StoryTag } from '../data/types';
import { daysBetween, weekStart } from './time';

export const PREP_KIND_LABEL: Record<PrepKind, string> = { oa: 'OA', mock: 'Mock', study: 'Study', story: 'Story' };
const PREP_STAGES: Stage[] = ['oa', 'interview', 'offer'];
const norm = (s: string) => s.trim().toLowerCase();

export interface PrepCompany { company: string; prep: CompanyPrep | null; stage: Stage | null; days: number | null }

export function prepCompanies(apps: Application[], prep: CompanyPrep[], today: string): PrepCompany[] {
  const out = new Map<string, PrepCompany>();
  for (const p of prep) out.set(norm(p.company), { company: p.company, prep: p, stage: null, days: p.interview_on ? daysBetween(today, p.interview_on) : null });
  for (const a of apps) {
    if (!PREP_STAGES.includes(a.stage)) continue;
    const k = norm(a.company);
    const cur = out.get(k);
    if (cur) { if (!cur.stage) cur.stage = a.stage; continue; }
    out.set(k, { company: a.company.trim(), prep: null, stage: a.stage, days: null });
  }
  const soon = (c: PrepCompany) => c.days !== null && c.days >= 0 && c.days <= 14;
  return [...out.values()].sort((a, b) =>
    Number(soon(b)) - Number(soon(a)) || (soon(a) && soon(b) ? a.days! - b.days! : 0)
    || (a.days === null ? 1 : 0) - (b.days === null ? 1 : 0) || a.company.localeCompare(b.company));
}

export function missingTags(stories: Story[]): StoryTag[] {
  const have = new Set(stories.flatMap((s) => s.tags));
  return STORY_TAGS.filter((t) => !have.has(t));
}

export function practicedLabel(day: string | null, today: string): string {
  if (!day) return 'never';
  const n = daysBetween(day, today);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

export function nextStatus(cur: PrepStatus | null): PrepStatus | null {
  return cur === null ? 'learning' : cur === 'learning' ? 'solid' : null;
}

export function weekSessions(sessions: PrepSession[], today: string): PrepSession[] {
  const start = weekStart(today);
  return sessions.filter((s) => s.happened_on >= start && s.happened_on <= today).sort((a, b) => a.happened_on.localeCompare(b.happened_on));
}
