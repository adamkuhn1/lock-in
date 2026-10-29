import { describe, expect, it } from 'vitest';
import cases from '../../../shared/company-key-cases.json';
import { companyKey, tierLabel, tierRank } from './tiers';

describe('tiers', () => {
  it('ranks reach, Midwest, volume, then untiered', () => {
    expect(['volume', null, 'reach', 'midwest'].map((t) => tierRank(t as never))).toEqual([2, 3, 0, 1]);
    expect(tierLabel('midwest')).toBe('Midwest');
    expect(tierLabel(null)).toBe('No tier');
  });
  it('companyKey matches the worker (shared/company-key-cases.json)', () => {
    for (const [name, key] of cases as [string, string][]) expect(companyKey(name), name).toBe(key);
  });
});
