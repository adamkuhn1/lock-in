import { describe, expect, it } from 'vitest';
import cases from '../../../shared/profile-cases.json';
import { mergedProfile, promptValues, type Profile } from './profile';

describe('profile', () => {
  for (const c of cases.cases) {
    it(`matches the worker: ${c.name}`, () => {
      expect(promptValues(c.profile as Profile)).toEqual(c.out);
    });
  }
  it('null is the defaults', () => {
    expect(promptValues(null)).toEqual(promptValues({}));
    expect(mergedProfile(undefined).grad).toBe('May 2027');
  });
});
