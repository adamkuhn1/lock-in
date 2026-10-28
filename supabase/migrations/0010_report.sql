-- Lock In: PDF report (Me → Your data → Make PDF report). Idempotent.
-- The Mac launcher writes every table to JSON, then a Claude session turns it into a visual PDF report.
alter table public.launch_requests drop constraint if exists launch_requests_kind_check;
alter table public.launch_requests add constraint launch_requests_kind_check
  check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview','tailor_resume','best_fit','report'));
