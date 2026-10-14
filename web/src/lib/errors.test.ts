import { describe, expect, it } from 'vitest';
import { shortError } from './errors';

describe('shortError (M8)', () => {
  it('keeps short single-line errors as they are', () => {
    expect(shortError('TransportError: timed out')).toBe('TransportError: timed out');
  });
  it('keeps the first line and caps the length', () => {
    expect(shortError('LaunchError: boom\n  at x.py:1\n  at y.py:2')).toBe('LaunchError: boom');
    const long = `E: ${'x'.repeat(300)}`;
    const s = shortError(long);
    expect(s.length).toBe(120);
    expect(s.endsWith('…')).toBe(true);
  });
});
