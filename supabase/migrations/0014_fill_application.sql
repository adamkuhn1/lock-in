-- Fill out application (Outreach card): a fill-only Claude in Chrome session with the card's tailored resume.
alter table public.launch_requests drop constraint if exists launch_requests_kind_check;
alter table public.launch_requests add constraint launch_requests_kind_check
  check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview','tailor_resume','best_fit','report','find_engineers',
                  'teach_item','check_module','review_module','fill_application'));
