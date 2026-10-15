// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('deploy config', () => {
  it('SPA rewrite sends app routes to index.html but leaves /api alone', () => {
    const v = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
    expect(v.rewrites).toEqual([{ source: '/((?!api/).*)', destination: '/index.html' }]);
    const re = new RegExp(`^${v.rewrites[0].source}$`);
    expect(re.test('/outreach')).toBe(true);
    expect(re.test('/api/sync-leetcode')).toBe(false);
  });
  it('api/ holds only deployable functions (no tests)', () => {
    expect(readdirSync(join(WEB, 'api')).sort()).toEqual(['sheet.ts', 'sync-leetcode.ts']);
  });
  it('no service-role key is referenced from browser code', () => {
    const hits = files(join(WEB, 'src')).filter((f) => /service_role|SERVICE_KEY/i.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
