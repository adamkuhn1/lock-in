import { describe, expect, it } from 'vitest';
import type { Outreach } from '../data/types';
import { copyPrompt } from './outreachPrompt';

const o: Outreach = {
  id: 'o-123', job_url: 'https://jobs.lever.co/acme/1?a=1&b=2', company: null, role: null, resume_path: null,
  status: 'queued', sent_on: null, follow_up_on: null, followups: 0, created_at: '2026-10-14T12:00:00Z',
};

describe('copyPrompt', () => {
  it('renders the shared template with the phone values from the Plan 3 contract', () => {
    const p = copyPrompt(o);
    expect(p).toContain('~/.lockin/venv/bin/lockin save-outreach --id o-123');
    expect(p).toContain('https://jobs.lever.co/acme/1?a=1&b=2');
    expect(p).toContain('Resume to use: (your Mac will pick the resume)');
    expect(p).toContain('unknown (read it from the posting)');
    expect(p).not.toContain('{{');
  });
  it('uses the company when known', () => {
    expect(copyPrompt({ ...o, company: 'Acme' })).toContain('Company (best guess, confirm it on the posting): Acme');
  });
});
