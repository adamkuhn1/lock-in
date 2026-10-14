// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAGE_RULES } from './stages';

describe('STAGE_RULES', () => {
  it('matches worker/lockin_worker/sheet.py exactly', () => {
    const py = readFileSync(fileURLToPath(new URL('../../../worker/lockin_worker/sheet.py', import.meta.url)), 'utf8');
    const block = py.split('STAGE_RULES = [')[1].split(']\n')[0];
    const pairs = [...block.matchAll(/\(r"([^"]+)",\s*"(\w+)"\)/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBeGreaterThan(0);
    expect(STAGE_RULES).toEqual(pairs);
  });
});
