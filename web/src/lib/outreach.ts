import type { LaunchRequest, Outreach } from '../data/types';
import { addDays, weekStart } from './time';

export const FOLLOW_UP_DAYS = 5;
export const followUpOn = (sentOn: string) => addDays(sentOn, FOLLOW_UP_DAYS);

export function followUpsDue(list: Outreach[], today: string): Outreach[] {
  return list.filter((o) => o.status === 'sent' && o.follow_up_on !== null && o.follow_up_on <= today);
}

export type Phase =
  | { kind: 'not_queued' } | { kind: 'queued' } | { kind: 'on_mac' } | { kind: 'failed'; error: string }
  | { kind: 'drafted' } | { kind: 'sent' } | { kind: 'due' } | { kind: 'replied' } | { kind: 'closed' };

export const PHASE_LABEL: Record<Phase['kind'], string> = {
  not_queued: 'Not queued', queued: 'Queued for Mac', on_mac: 'Opened on Mac', failed: 'Launch failed',
  drafted: 'Drafted', sent: 'Sent', due: 'Follow up', replied: 'Replied', closed: 'Closed',
};

function latestRequest(o: Outreach, requests: LaunchRequest[]): LaunchRequest | null {
  const mine = requests.filter((r) => r.kind === 'outreach' && r.payload.outreach_id === o.id);
  mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return mine[0] ?? null;
}

export function outreachPhase(o: Outreach, requests: LaunchRequest[], today: string): Phase {
  switch (o.status) {
    case 'queued': {
      const r = latestRequest(o, requests);
      if (!r) return { kind: 'not_queued' };
      if (r.status === 'queued') return { kind: 'queued' };
      if (r.status === 'launched') return { kind: 'on_mac' };
      return { kind: 'failed', error: r.error ?? 'Unknown error' };
    }
    case 'sent':
      return o.follow_up_on !== null && o.follow_up_on <= today ? { kind: 'due' } : { kind: 'sent' };
    default:
      return { kind: o.status };
  }
}

const RANK: Record<Phase['kind'], number> = {
  due: 0, failed: 1, not_queued: 1, drafted: 1, queued: 2, on_mac: 2, sent: 3, replied: 4, closed: 4,
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
