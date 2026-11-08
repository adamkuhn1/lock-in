-- Lock In: LeetCode ratings match how Adam works a problem. Idempotent.
--   solo       solved it myself                                  (was nailed or struggled: both meant unaided)
--   explained  watched the NeetCode explanation, then wrote it myself
--   codealong  coded along with the solution                     (was help)
-- Learning items keep their own nailed/struggled/help scale.

alter table public.lc_solves drop constraint if exists lc_solves_rating_check;
alter table public.lc_solves drop constraint if exists lc_solves_effective_rating_check;

update public.lc_solves set rating = case rating when 'help' then 'codealong' else 'solo' end
  where rating in ('nailed', 'struggled', 'help');
update public.lc_solves set effective_rating = case effective_rating when 'help' then 'codealong' else 'solo' end
  where effective_rating in ('nailed', 'struggled', 'help');

alter table public.lc_solves add constraint lc_solves_rating_check
  check (rating in ('solo', 'explained', 'codealong'));
alter table public.lc_solves add constraint lc_solves_effective_rating_check
  check (effective_rating in ('solo', 'explained', 'codealong'));

-- lapses now counts misses in a row, and a problem parks after two. Clear old totals so nothing parks on history.
update public.lc_problem_state set lapses = 0 where state <> 'parked';

-- The old 10-day timer moved the focus before topics were learned. Clear it once so the worker restarts at the first
-- topic on the roadmap that isn't Mastered; from here the focus moves only when a topic is Mastered (or picked by hand).
update public.settings set lc_focus_topic = null, lc_focus_since = null;
