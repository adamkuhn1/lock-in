-- Lock In: follow-up clock. Idempotent.
-- outreach.followups: how many follow-up emails have been sent (0 = the first follow-up is still to come).
alter table public.outreach add column if not exists followups int not null default 0;
