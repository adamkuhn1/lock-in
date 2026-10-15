import type { Contact, LaunchRequest, Outreach } from '../data/types';
import { addDays, daysBetween, weekStart } from './time';

export const FOLLOW_UP_DAYS = 5;
export const FOLLOW_UP_RETRY_DAYS = 7;
export const followUpOn = (sentOn: string) => addDays(sentOn, FOLLOW_UP_DAYS);

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** The follow-up clock for a sent card, or null when there is nothing to say. */
export function followUpLabel(o: Outreach, today: string): string | null {
  if (o.status !== 'sent' || o.follow_up_on === null) return null;
  const left = daysBetween(today, o.follow_up_on);
  if (left > 0) {
    if (o.followups >= 1) return left === 1 ? 'Check back tomorrow' : `Check back in ${plural(left)}`;
    return left === 1 ? 'Follow up tomorrow' : `Follow up in ${plural(left)}`;
  }
  if (o.followups >= 1) return 'No reply yet \u2014 close?';
  return left === 0 ? 'Follow up today' : `Overdue ${plural(-left)}`;
}

/** A short nudge to the same contact, sent as a reply-style subject. */
export function followUpDraft(o: Outreach, contact: Contact): { subject: string; body: string } {
  const base = contact.draft_subject?.trim() || 'my application';
  const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
  const first = contact.name.trim().split(/\s+/)[0] || 'there';
  const company = o.company?.trim();
  const body = `Hi ${first},\n\nFollowing up on my application to ${o.role?.trim() || 'the role'}${company ? ` at ${company}` : ''}. I'm still very interested and happy to share anything that would help.\n\nPortfolio: https://adamkuhn.vercel.app\n\nThanks,\nAdam`;
  return { subject, body };
}

export function followUpsDue(list: Outreach[], today: string): Outreach[] {
  return list.filter((o) => o.status === 'sent' && o.follow_up_on !== null && o.follow_up_on <= today);
}

export type Phase =
  | { kind: 'not_queued' } | { kind: 'queued' } | { kind: 'on_mac' } | { kind: 'failed'; error: string } | { kind: 'resume_ready' }
  | { kind: 'drafted' } | { kind: 'sent' } | { kind: 'due' } | { kind: 'replied' } | { kind: 'closed' };

export const PHASE_LABEL: Record<Phase['kind'], string> = {
  not_queued: 'Not queued', queued: 'Queued for Mac', on_mac: 'Opened on Mac', failed: 'Launch failed', resume_ready: 'Resume ready',
  drafted: 'Drafted', sent: 'Sent', due: 'Follow up', replied: 'Replied', closed: 'Closed',
};

/** Launch kinds that draft contacts for an outreach row (Cold email, and Tailor resume which also drafts). */
const OUTREACH_KINDS: ReadonlySet<LaunchRequest['kind']> = new Set(['outreach', 'tailor_resume']);

export function latestRequest(o: Outreach, requests: LaunchRequest[]): LaunchRequest | null {
  const mine = requests.filter((r) => OUTREACH_KINDS.has(r.kind) && r.payload.outreach_id === o.id);
  mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return mine[0] ?? null;
}

export function outreachPhase(o: Outreach, requests: LaunchRequest[], today: string): Phase {
  switch (o.status) {
    case 'queued': {
      const r = latestRequest(o, requests);
      if (!r) return { kind: 'not_queued' };
      if (r.status === 'queued') return { kind: 'queued' };
      // A tailor run saves resume_path itself (Cold email sets it at launch), so this means: resume done, no recruiter yet.
      if (r.status === 'launched') return r.kind === 'tailor_resume' && o.resume_path ? { kind: 'resume_ready' } : { kind: 'on_mac' };
      return { kind: 'failed', error: r.error ?? 'Unknown error' };
    }
    case 'sent':
      return o.follow_up_on !== null && o.follow_up_on <= today ? { kind: 'due' } : { kind: 'sent' };
    default:
      return { kind: o.status };
  }
}

const RANK: Record<Phase['kind'], number> = {
  due: 0, failed: 1, not_queued: 1, drafted: 1, resume_ready: 1, queued: 2, on_mac: 2, sent: 3, replied: 4, closed: 4,
};

export function sortOutreach(list: Outreach[], requests: LaunchRequest[], today: string): Outreach[] {
  return [...list].sort((a, b) =>
    RANK[outreachPhase(a, requests, today).kind] - RANK[outreachPhase(b, requests, today).kind] ||
    Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Outreach marked sent this week (Mon..today). */
export function sentThisWeek(outreach: Pick<Outreach, 'sent_on'>[], today: string): number {
  const start = weekStart(today);
  return outreach.filter((o) => o.sent_on !== null && o.sent_on >= start && o.sent_on <= today).length;
}

/** The same plain-address rule save-outreach enforces (worker/lockin_worker/cli.py EMAIL). */
const PLAIN_EMAIL = /^[^\s@,;?&#<>"']+@[^\s@,;?&#<>"']+\.[A-Za-z]{2,}$/;
export const isPlainEmail = (s: string) => PLAIN_EMAIL.test(s);

/** A mailto: link that opens a prefilled draft in the default mail app (CRLF line breaks, everything encoded). */
export function mailtoHref(to: string, subject: string, body: string): string {
  const enc = (v: string) => encodeURIComponent(v.replace(/\r?\n/g, '\r\n'));
  return `mailto:${enc(to).replace(/%40/g, '@')}?subject=${enc(subject)}&body=${enc(body)}`;
}
