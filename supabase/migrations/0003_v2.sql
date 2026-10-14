-- Lock In v2: settings, optional repo, idea start time, launch kinds, prep, calendar, day_activity.
-- Idempotent: safe to re-run.

alter table public.settings
  add column if not exists day_one date not null default '2026-09-28',
  add column if not exists weekly_email_target int not null default 10;
alter table public.settings drop constraint if exists settings_weekly_email_target_check;
alter table public.settings add constraint settings_weekly_email_target_check check (weekly_email_target between 1 and 100);

alter table public.projects alter column repo drop not null;

alter table public.ideas add column if not exists started_at timestamptz;
alter table public.ideas drop constraint if exists ideas_status_check;
alter table public.ideas add constraint ideas_status_check check (status in ('todo','today','in_progress','done','dropped'));

alter table public.launch_requests drop constraint if exists launch_requests_kind_check;
alter table public.launch_requests add constraint launch_requests_kind_check check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview'));

create table if not exists public.stories (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  title text not null,
  tags text[] not null default '{}' check (tags <@ array['leadership','conflict','failure','impact','teamwork']::text[]),
  situation text not null default '',
  task text not null default '',
  action text not null default '',
  result text not null default '',
  last_practiced_on date,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table if not exists public.prep_sessions (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  kind text not null check (kind in ('oa','mock','study','story')),
  minutes int check (minutes between 1 and 600),
  note text,
  company text,
  story_id uuid,
  happened_on date not null,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table if not exists public.prep_items (
  id text primary key,
  track text not null check (track in ('system_design','cs')),
  title text not null,
  ord int not null
);

create table if not exists public.prep_progress (
  owner uuid not null default auth.uid(),
  item_id text not null,
  status text not null check (status in ('learning','solid')),
  updated_at timestamptz not null default now(),
  primary key (owner, item_id)
);

create table if not exists public.company_prep (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  company text not null,
  notes text not null default '',
  links text not null default '',
  interview_on date,
  created_at timestamptz not null default now(),
  primary key (owner, id),
  unique (owner, company)
);

create table if not exists public.events (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  title text not null,
  kind text not null check (kind in ('app_open','deadline','oa','interview','other')),
  on_date date not null,
  at_time time,
  company text,
  url text,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

alter table public.stories enable row level security;
drop policy if exists stories_owner on public.stories;
create policy stories_owner on public.stories for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
alter table public.prep_sessions enable row level security;
drop policy if exists prep_sessions_owner on public.prep_sessions;
create policy prep_sessions_owner on public.prep_sessions for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
alter table public.prep_progress enable row level security;
drop policy if exists prep_progress_owner on public.prep_progress;
create policy prep_progress_owner on public.prep_progress for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
alter table public.company_prep enable row level security;
drop policy if exists company_prep_owner on public.company_prep;
create policy company_prep_owner on public.company_prep for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
alter table public.events enable row level security;
drop policy if exists events_owner on public.events;
create policy events_owner on public.events for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
alter table public.prep_items enable row level security;
drop policy if exists prep_items_read on public.prep_items;
create policy prep_items_read on public.prep_items for select to authenticated using (true);

create index if not exists prep_sessions_day on public.prep_sessions (owner, happened_on);
create index if not exists events_day on public.events (owner, on_date);

-- One row per owner per plan day (America/Detroit, day starts 04:00) from day_one through today.
create or replace view public.day_activity with (security_invoker = true) as
with s as (
  select owner, day_one,
         ((now() - interval '4 hours') at time zone 'America/Detroit')::date as today
  from public.settings
),
days as (
  select s.owner, d::date as day
  from s, generate_series(s.day_one, s.today, interval '1 day') as d
),
sv as (select owner, ((accepted_at - interval '4 hours') at time zone 'America/Detroit')::date as day, count(*) as n
       from public.lc_solves group by 1, 2),
av as (select owner, applied_on as day, count(*) as n from public.applications where applied_on is not null group by 1, 2),
ov as (select owner, sent_on as day, count(*) as n from public.outreach where sent_on is not null group by 1, 2),
cv as (select owner, ((committed_at - interval '4 hours') at time zone 'America/Detroit')::date as day, count(*) as n
       from public.commits group by 1, 2),
pv as (select owner, happened_on as day, count(*) as n from public.prep_sessions group by 1, 2),
j as (
  select d.owner, d.day,
         coalesce(sv.n, 0)::int as solves,
         coalesce(av.n, 0)::int as applications,
         coalesce(ov.n, 0)::int as outreach_sent,
         coalesce(cv.n, 0)::int as commits,
         coalesce(pv.n, 0)::int as prep_sessions
  from days d
  left join sv using (owner, day)
  left join av using (owner, day)
  left join ov using (owner, day)
  left join cv using (owner, day)
  left join pv using (owner, day)
)
select j.*,
       k.kinds,
       least(k.kinds, 4) as intensity,
       k.kinds > 0 as active
from j
cross join lateral (
  select (j.solves > 0)::int + (j.applications > 0)::int + (j.outreach_sent > 0)::int
       + (j.commits > 0)::int + (j.prep_sessions > 0)::int as kinds
) k;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.day_activity to authenticated, service_role;
