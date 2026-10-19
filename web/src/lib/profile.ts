import defaultsJson from '../../../shared/profile_defaults.json';

/** Adam's profile (settings.profile, edited on the Me tab). Same rules as worker/lockin_worker/profile.py. */
export const PROFILE_FIELDS = ['name', 'school', 'degree', 'grad', 'grad_late', 'experience', 'targets', 'locations', 'notes'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type Profile = Partial<Record<ProfileField, string>>;
export const PROFILE_DEFAULTS = defaultsJson as Record<ProfileField, string>;

/** Defaults, overridden by every non-blank field Adam has set. */
export function mergedProfile(p: Profile | null | undefined): Record<ProfileField, string> {
  const out = { ...PROFILE_DEFAULTS };
  for (const k of PROFILE_FIELDS) {
    const v = p?.[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().split(/\s+/).join(' ');
  }
  return out;
}

const stop = (s: string) => s.replace(/\.$/, '');

/** The values the Claude prompts use: the "Who Adam is" bullets, and the fit check's dates and targets. */
export function promptValues(p: Profile | null | undefined): { who: string; grad: string; grad_late: string; targets: string } {
  const m = mergedProfile(p);
  const later = m.grad_late && m.grad_late !== m.grad ? m.grad_late : '';
  const lines = [`- ${m.school}. ${m.degree}, graduating ${m.grad}.`];
  if (m.experience) lines.push(`- ${stop(m.experience)}.`);
  lines.push(`- Looking for ${stop(m.targets)}.${later ? ` For the right role he will push graduation to ${later}.` : ''}`);
  if (m.locations) lines.push(`- Prefers ${stop(m.locations)}.`);
  if (m.notes) lines.push(`- ${stop(m.notes)}.`);
  return { who: lines.join('\n'), grad: m.grad, grad_late: m.grad_late || m.grad, targets: m.targets };
}
