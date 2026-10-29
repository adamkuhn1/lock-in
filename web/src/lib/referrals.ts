import type { Application, LaunchRequest, Outreach, Referral, ReferralPick, ReferralStatus, Tier } from '../data/types';
import { companyKey, tierRank, TIERS } from './tiers';
import { addDays, daysBetween, weekStart } from './time';

/** Follow up 3-4 days after an engineer accepts (worker/lockin_worker/streaks.py REFERRAL_FOLLOW_UP_DAYS). */
export const FOLLOW_UP_DAYS = 3;
export const FOLLOW_UP_LATE_DAYS = 4;
/** LinkedIn connection notes; `lockin save-engineers` and the database enforce it too. */
export const NOTE_MAX = 280;

export const PICK_LABEL: Record<ReferralPick, string> = { ex_apple: 'Ex-Apple', cmu: 'CMU alum', team: 'Same team', other: 'Engineer' };
export const STATUS_LABEL: Record<ReferralStatus, string> = {
  drafted: 'Drafted', sent: 'Sent', accepted: 'Accepted', replied: 'Replied', referred: 'Referred', closed: 'Closed',
};
/** The five steps, in order (closed sits outside them). */
export const STEPS: ReferralStatus[] = ['drafted', 'sent', 'accepted', 'replied', 'referred'];

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
export const followUpOn = (r: Pick<Referral, 'accepted_on'>) => (r.accepted_on ? addDays(r.accepted_on, FOLLOW_UP_DAYS) : null);

export function followUpDue(r: Referral, today: string): boolean {
  const on = followUpOn(r);
  return r.status === 'accepted' && !r.followed_up_on && on !== null && on <= today;
}

/** What to do next for one engineer, or null when there's nothing to say. */
export function nextStep(r: Referral, today: string): string | null {
  if (r.status === 'sent' && r.sent_on) {
    const n = daysBetween(r.sent_on, today);
    return n <= 0 ? 'Waiting to accept' : `Waiting to accept · sent ${plural(n)} ago`;
  }
  if (r.status !== 'accepted') return null;
  if (r.followed_up_on) return 'Followed up · waiting for a reply';
  const on = followUpOn(r);
  if (!on) return 'Send a follow-up in 3-4 days';
  const left = daysBetween(today, on);
  if (left > 1) return `Follow up in ${plural(left)}`;
  if (left === 1) return 'Follow up tomorrow';
  if (left === 0) return 'Follow up today';
  if (-left <= FOLLOW_UP_LATE_DAYS - FOLLOW_UP_DAYS) return 'Follow up today (day 4)';
  return `Follow-up overdue ${plural(-left - (FOLLOW_UP_LATE_DAYS - FOLLOW_UP_DAYS))}`;
}

/** The message after they accept: thank them, name the role, repeat the one ask. */
export function followUpMessage(r: Referral): string {
  const first = r.name.trim().split(/\s+/)[0] || 'there';
  const role = r.role?.trim() || 'the new grad software engineering role';
  return `Thanks for connecting, ${first}! I applied to ${r.company}'s ${role} role. I was a SWE intern at Apple this summer, `
    + `and I'd love to be considered. Would you be open to referring me? Happy to send my resume, or answer anything about my background. Thanks, Adam`;
}

/** LinkedIn notes marked sent this week (Mon..today). */
export function notesSentThisWeek(refs: Pick<Referral, 'sent_on'>[], today: string): number {
  const start = weekStart(today);
  return refs.filter((r) => r.sent_on !== null && r.sent_on >= start && r.sent_on <= today).length;
}

export const followUpsDue = (refs: Referral[], today: string) => refs.filter((r) => followUpDue(r, today));

export interface JobGroup { key: string; company: string; role: string | null; tier: Tier | null; job_url: string | null; posting_id: string | null; refs: Referral[] }

/** One card per job: the engineers saved by one Find engineers run (or, for older rows, the same company and role). */
export function groupByJob(refs: Referral[]): JobGroup[] {
  const out = new Map<string, JobGroup>();
  for (const r of [...refs].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const key = r.request_id ?? `${companyKey(r.company)}|${(r.role ?? '').trim().toLowerCase()}`;
    const g = out.get(key) ?? { key, company: r.company, role: r.role, tier: r.tier, job_url: r.job_url, posting_id: r.posting_id, refs: [] };
    g.refs.push(r);
    out.set(key, g);
  }
  return [...out.values()];
}

const RANK: Record<ReferralStatus, number> = { drafted: 1, accepted: 2, sent: 3, replied: 2, referred: 4, closed: 5 };
const groupRank = (g: JobGroup, today: string) =>
  g.refs.some((r) => followUpDue(r, today)) ? 0 : Math.min(...g.refs.map((r) => RANK[r.status]));
export const isDone = (g: JobGroup) => g.refs.every((r) => r.status === 'referred' || r.status === 'closed');

/** Follow-ups due first, then notes to send, then people to hear back from; newest first within each. */
export function sortGroups(groups: JobGroup[], today: string): JobGroup[] {
  const newest = (g: JobGroup) => g.refs.reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
  return [...groups].sort((a, b) => groupRank(a, today) - groupRank(b, today) || tierRank(a.tier) - tierRank(b.tier)
    || newest(b).localeCompare(newest(a)));
}

/** The Find engineers request for a job, newest first: by posting, else by company. */
export function latestFind(requests: LaunchRequest[], job: { posting_id?: string | null; company: string }): LaunchRequest | null {
  const mine = requests.filter((r) => r.kind === 'find_engineers' && (job.posting_id
    ? r.payload.posting_id === job.posting_id
    : !r.payload.posting_id && companyKey(String(r.payload.company ?? '')) === companyKey(job.company)));
  return mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
}

// ---- Reply rates by tier ----

export interface ReplyCell { sent: number; replied: number }
export interface ReplyRow { tier: Tier | null; notes: ReplyCell; emails: ReplyCell }

const noteReplied = (r: Referral) => r.replied_on !== null || r.status === 'replied' || r.status === 'referred';
const emailReplied = (o: Outreach) => !!o.replied_on || o.status === 'replied';

/** LinkedIn notes and recruiter emails: how many were sent and how many got a reply, per tier. */
export function replyRates(refs: Referral[], outreach: Outreach[]): ReplyRow[] {
  const rows = new Map<Tier | null, ReplyRow>([...TIERS, null].map((t) => [t, { tier: t, notes: { sent: 0, replied: 0 }, emails: { sent: 0, replied: 0 } }]));
  for (const r of refs) {
    if (!r.sent_on) continue;
    const row = rows.get(r.tier ?? null)!;
    row.notes.sent += 1;
    if (noteReplied(r)) row.notes.replied += 1;
  }
  for (const o of outreach) {
    if (!o.sent_on) continue;
    const row = rows.get(o.tier ?? null)!;
    row.emails.sent += 1;
    if (emailReplied(o)) row.emails.replied += 1;
  }
  // Untiered rows only show when there's something in them.
  return [...rows.values()].filter((r) => r.tier !== null || r.notes.sent + r.emails.sent > 0);
}

export const replyTotal = (rows: ReplyRow[], k: 'notes' | 'emails'): ReplyCell =>
  rows.reduce((t, r) => ({ sent: t.sent + r[k].sent, replied: t.replied + r[k].replied }), { sent: 0, replied: 0 });

export const ratePct = (c: ReplyCell): string => (c.sent === 0 ? '—' : `${Math.round((c.replied / c.sent) * 100)}%`);

// ---- Reach applications with nobody behind them ----

export type Backing = 'none' | 'drafted' | 'contacted';

/** Has Adam reached an engineer at this company? Drafted notes don't count until they're sent. */
export function backing(company: string, refs: Referral[]): Backing {
  const key = companyKey(company);
  const mine = refs.filter((r) => companyKey(r.company) === key);
  if (mine.some((r) => r.sent_on !== null || (r.status !== 'drafted' && r.status !== 'closed'))) return 'contacted';
  return mine.some((r) => r.status === 'drafted') ? 'drafted' : 'none';
}

/** Reach applications still in play (not rejected or decided) with no engineer contacted at the company. */
export function reachWithoutContact(apps: Application[], refs: Referral[]): Application[] {
  return apps.filter((a) => a.tier === 'reach' && a.stage !== 'closed' && a.stage !== 'offer' && backing(a.company, refs) !== 'contacted');
}
