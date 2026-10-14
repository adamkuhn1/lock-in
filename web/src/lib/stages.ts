import type { Stage } from '../data/types';

export const STAGE_RULES: [pattern: string, stage: Stage][] = [
  ['^offer', 'offer'],
  ['reject|withdr|declin|closed|ghost|no response', 'closed'],
  ['interview|^r\\d|round|onsite|superday|final|phone|screen', 'interview'],
  ['^oa|assessment|hackerrank|codesignal', 'oa'],
  ['not applied|to apply|planned|draft|wishlist', 'other'],
  ['submit|applied|^apply', 'applied'],
];
