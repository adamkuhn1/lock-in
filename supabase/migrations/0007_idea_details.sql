-- Lock In: idea details. Idempotent.
-- ideas.text is the plain-English title shown in the app; ideas.details is the technical brief
-- (files, functions, approach) handed to Claude Code when Adam taps "Work on this". Null for old ideas.
alter table public.ideas add column if not exists details text;
