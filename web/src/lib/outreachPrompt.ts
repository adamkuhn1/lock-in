import template from '../../../prompts/outreach.md?raw';
import type { Outreach } from '../data/types';
import { renderTemplate } from './prompt';

// Same template and placeholders as the launcher (Plan 3). Values fixed by the contract with Plan 3.
export const WEB_RESUME_PATH = '(your Mac will pick the resume)';
export const WEB_LOCKIN = '~/.lockin/venv/bin/lockin';

export function copyPrompt(o: Outreach): string {
  return renderTemplate(template, {
    outreach_id: o.id,
    job_url: o.job_url,
    company: o.company ?? 'unknown (read it from the posting)',
    resume_path: WEB_RESUME_PATH,
    resume_note: '',
    lockin: WEB_LOCKIN,
  });
}
