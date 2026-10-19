-- Lock In: Adam's profile (Me tab). Idempotent.
-- settings.profile: who Adam is, edited on the Me tab. The Tailor resume and Cold email prompts (and their fit
-- check) read it; any field left out falls back to the prompts' defaults. Keys: name, school, degree, grad,
-- grad_late, experience, targets, locations, links.
alter table public.settings add column if not exists profile jsonb not null default '{}'::jsonb;
