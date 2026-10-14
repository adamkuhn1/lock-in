import { describe, expect, it } from 'vitest';
import { hostOf, isJobUrl, safeHref } from './url';

describe('url', () => {
  it('safeHref allows only http(s)', () => {
    expect(safeHref('https://boards.greenhouse.io/stripe/jobs/1')).toBe('https://boards.greenhouse.io/stripe/jobs/1');
    expect(safeHref('http://x.com/a')).toBe('http://x.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(' JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('ftp://x.com')).toBeNull();
    expect(safeHref('linkedin.com/in/a')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
  it('safeHref returns the parsed, normalized href (M2)', () => {
    expect(safeHref('  https://X.com/a b ')).toBe('https://x.com/a%20b');
    expect(safeHref('https://x.com')).toBe('https://x.com/');
  });
  it('isJobUrl needs http(s) and a dotted host', () => {
    expect(isJobUrl('https://jobs.lever.co/ramp/1')).toBe(true);
    expect(isJobUrl('  https://jobs.lever.co/ramp/1  ')).toBe(true);
    expect(isJobUrl('jobs.lever.co/ramp')).toBe(false);
    expect(isJobUrl('https://localhost/x')).toBe(false);
    expect(isJobUrl('javascript:alert(1)')).toBe(false);
  });
  it('hostOf strips www', () => {
    expect(hostOf('https://www.amazon.jobs/en/jobs/1')).toBe('amazon.jobs');
    expect(hostOf('nope')).toBe('nope');
  });
});
