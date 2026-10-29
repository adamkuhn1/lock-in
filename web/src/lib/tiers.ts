import type { Tier } from '../data/types';

export const TIERS: readonly Tier[] = ['reach', 'midwest', 'volume'];
export const TIER_LABEL: Record<Tier, string> = { reach: 'Reach', midwest: 'Midwest', volume: 'Volume' };
/** Sort order: reach first, then Midwest/Chicago, then volume, then anything untiered. */
export const tierRank = (t: Tier | null | undefined): number => (t ? TIERS.indexOf(t) : TIERS.length);
export const tierLabel = (t: Tier | null | undefined): string => (t ? TIER_LABEL[t] : 'No tier');

/** The same company-name match the worker uses (job_radar/tiers.py company_key): "Stripe, Inc." equals "stripe". */
export function companyKey(name: string | null | undefined): string {
  let s = (name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  s = s.replace(/^the\s+/, '').replace(/\s+and\s+co$/, '');
  return s.replace(/(?:\s+(?:inc|llc|ltd|corp|corporation|co|company|plc|holdings|technologies|labs))+$/, '').trim();
}
