import { describe, expect, it } from 'vitest';
import { TemplateError, renderTemplate } from './prompt';

describe('renderTemplate (same rules as the Python launcher)', () => {
  it('fills once and never re-expands', () => {
    expect(renderTemplate('Hi {{name}}, id={{ id }}', { name: '{{id}}', id: '7' })).toBe('Hi {{id}}, id=7');
  });
  it('throws on a missing value', () => {
    expect(() => renderTemplate('{{a}} {{b}}', { a: '1' })).toThrow(TemplateError);
    expect(() => renderTemplate('{{a}} {{b}}', { a: '1' })).toThrow('missing values for: b');
  });
});
