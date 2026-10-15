import type { Stage } from '../data/types';

export const STAGE_RULES: [pattern: string, stage: Stage][] = [
  ['^offer', 'offer'],
  ['reject|withdr|declin|closed|ghost|no response', 'closed'],
  ['interview|^r\\d|round|onsite|superday|final|phone|screen', 'interview'],
  ['^oa|assessment|hackerrank|codesignal', 'oa'],
  ['not applied|to apply|planned|draft|wishlist', 'other'],
  ['submit|applied|^apply', 'applied'],
];

const RULES = STAGE_RULES.map(([p, stage]) => [new RegExp(p), stage] as const);

/** Same as worker sheet.status_stage: lowercase, collapse whitespace, first matching rule wins. */
export function statusStage(status: string | null | undefined): Stage {
  const s = (status ?? '').trim().toLowerCase().split(/\s+/).join(' ');
  if (!s) return 'other';
  return RULES.find(([re]) => re.test(s))?.[1] ?? 'other';
}
