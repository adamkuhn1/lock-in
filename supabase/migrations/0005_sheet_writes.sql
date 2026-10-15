-- Lock In: write to the application Sheet. Idempotent.
-- applications.sheet_row: the 1-based Sheet row the sync read each application from (/api/sheet re-checks it before writing).
alter table public.applications add column if not exists sheet_row int;

-- postings.status gains 'applied' (set by "I applied"). 0001's inline check is auto-named postings_status_check.
alter table public.postings drop constraint if exists postings_status_check;
alter table public.postings add constraint postings_status_check check (status in ('new','seen','dismissed','outreach','applied'));
