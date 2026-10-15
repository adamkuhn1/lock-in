-- Lock In: "Tailor resume" launch kind (tailors a resume copy, then drafts recruiter outreach).
alter table public.launch_requests drop constraint if exists launch_requests_kind_check;
alter table public.launch_requests add constraint launch_requests_kind_check check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview','tailor_resume'));
