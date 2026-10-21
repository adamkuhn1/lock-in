-- Lock In: Best fit picks (Hunt → Jobs → Find best fits). Idempotent.
-- A Claude session reads Adam's resume, applications and inbox, researches new postings, and saves a ranked
-- shortlist with `lockin save-picks`. Each save replaces the previous shortlist.
--   postings.fit_rank:   1 = best; null = not on the shortlist
--   postings.fit_reason: one line on why it fits Adam
--   postings.found_by:   'claude' for postings Claude found on the web; null for the job scanner
alter table public.postings add column if not exists fit_rank int;
alter table public.postings add column if not exists fit_reason text;
alter table public.postings add column if not exists found_by text;

alter table public.launch_requests drop constraint if exists launch_requests_kind_check;
alter table public.launch_requests add constraint launch_requests_kind_check
  check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview','tailor_resume','best_fit'));
