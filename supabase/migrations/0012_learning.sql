-- Lock In: learning tracks (Grind -> CS, Math, Founder). Idempotent.
-- Content (modules and items) is global and read-only for the app, like prep_items. The worker upserts it from
-- shared/learning.json on every sync, so editing that file is all it takes to change a track.
-- Nothing is locked: modules have a recommended order (ord), and every one can be started at any time.

create table if not exists public.learn_modules (
  id text primary key,
  track text not null check (track in ('cs', 'math', 'founder')),
  ord int not null,
  title text not null,
  summary text not null default ''
);

-- type: watch (free video course), do (practice), build (applied project), check (quiz / explain-it-back / honor)
create table if not exists public.learn_items (
  id text primary key,
  module_id text not null references public.learn_modules (id) on delete cascade,
  ord int not null,
  type text not null check (type in ('watch', 'do', 'build', 'check')),
  title text not null,
  url text,
  hours numeric not null default 1 check (hours >= 0),
  project text,
  check_kind text check (check_kind in ('quiz', 'explain', 'honor')),
  details text not null default ''
);
create index if not exists learn_items_module on public.learn_items (module_id, ord);

-- Adam's progress on one item. rating uses the LeetCode scale.
create table if not exists public.learn_progress (
  owner uuid not null default auth.uid(),
  item_id text not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done')),
  rating text check (rating in ('nailed', 'struggled', 'help')),
  notes text not null default '',
  started_on date,
  done_on date,
  updated_at timestamptz not null default now(),
  primary key (owner, item_id)
);

-- A module Adam marked done. Spaced reviews are scheduled from done_on and the reviews since (learn_checks).
create table if not exists public.learn_module_state (
  owner uuid not null default auth.uid(),
  module_id text not null,
  done_on date not null,
  primary key (owner, module_id)
);

-- Claude's "Check me" quizzes and the 3-question spaced reviews, written back with `lockin save-check`.
create table if not exists public.learn_checks (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  module_id text not null,
  kind text not null check (kind in ('check', 'review')),
  score int not null check (score >= 0),
  total int not null check (total > 0 and score <= total),
  rating text not null check (rating in ('nailed', 'struggled', 'help')),
  summary text not null default '',
  taken_on date not null,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);
create index if not exists learn_checks_module on public.learn_checks (owner, module_id, taken_on);

alter table public.learn_modules enable row level security;
drop policy if exists learn_modules_read on public.learn_modules;
create policy learn_modules_read on public.learn_modules for select to authenticated using (true);
alter table public.learn_items enable row level security;
drop policy if exists learn_items_read on public.learn_items;
create policy learn_items_read on public.learn_items for select to authenticated using (true);
alter table public.learn_progress enable row level security;
drop policy if exists learn_progress_owner on public.learn_progress;
create policy learn_progress_owner on public.learn_progress for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
alter table public.learn_module_state enable row level security;
drop policy if exists learn_module_state_owner on public.learn_module_state;
create policy learn_module_state_owner on public.learn_module_state for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
alter table public.learn_checks enable row level security;
drop policy if exists learn_checks_owner on public.learn_checks;
create policy learn_checks_owner on public.learn_checks for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- ---- Settings: daily study time and how much of it goes to learning (the rest is LeetCode + Prep) ----
alter table public.settings add column if not exists study_minutes int not null default 180;
alter table public.settings drop constraint if exists settings_study_minutes_check;
alter table public.settings add constraint settings_study_minutes_check check (study_minutes between 15 and 960);
alter table public.settings add column if not exists learn_split int not null default 30;
alter table public.settings drop constraint if exists settings_learn_split_check;
alter table public.settings add constraint settings_learn_split_check check (learn_split between 0 and 100);

alter table public.launch_requests drop constraint if exists launch_requests_kind_check;
alter table public.launch_requests add constraint launch_requests_kind_check
  check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview','tailor_resume','best_fit','report','find_engineers',
                  'teach_item','check_module','review_module'));

-- ---- Activity: finishing a learning item or taking a check counts as prep for the day ----
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
ov as (select owner, day, count(*) as n from (
         select owner, sent_on as day from public.outreach where sent_on is not null
         union all
         select owner, sent_on as day from public.referrals where sent_on is not null
       ) x group by 1, 2),
cv as (select owner, ((committed_at - interval '4 hours') at time zone 'America/Detroit')::date as day, count(*) as n
       from public.commits group by 1, 2),
pv as (select owner, day, count(*) as n from (
         select owner, happened_on as day from public.prep_sessions
         union all
         select owner, done_on as day from public.learn_progress where done_on is not null
         union all
         select owner, taken_on as day from public.learn_checks
       ) x group by 1, 2),
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

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.day_activity to authenticated, service_role;
