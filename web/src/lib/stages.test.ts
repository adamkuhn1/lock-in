// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAGE_RULES, statusStage } from './stages';

describe('STAGE_RULES', () => {
  it('matches worker/lockin_worker/sheet.py exactly', () => {
    const py = readFileSync(fileURLToPath(new URL('../../../worker/lockin_worker/sheet.py', import.meta.url)), 'utf8');
    const block = py.split('STAGE_RULES = [')[1].split(']\n')[0];
    const pairs = [...block.matchAll(/\(r"([^"]+)",\s*"(\w+)"\)/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBeGreaterThan(0);
    expect(STAGE_RULES).toEqual(pairs);
  });
});

describe('statusStage', () => {
  it('mirrors worker status_stage (first match wins; blank is other)', () => {
    expect(statusStage('Submitted - verify latest')).toBe('applied');
    expect(statusStage('OA invited')).toBe('oa');
    expect(statusStage('  Interview -  R1 ')).toBe('interview');
    expect(statusStage('Rejected after OA')).toBe('closed');
    expect(statusStage('Offer declined')).toBe('offer');
    expect(statusStage('Not applied yet')).toBe('other');
    expect(statusStage('Applied')).toBe('applied');
    expect(statusStage('')).toBe('other');
    expect(statusStage(null)).toBe('other');
    expect(statusStage('Something else')).toBe('other');
  });
});
