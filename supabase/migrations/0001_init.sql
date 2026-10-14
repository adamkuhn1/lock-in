-- Lock In schema. Every user table: owner = auth.uid() via RLS. Worker uses the service role.

create table public.problems (
  slug text primary key,
  lc_id int,
  title text not null,
  difficulty text not null check (difficulty in ('Easy','Medium','Hard')),
  topic text not null,
  lists text[] not null default '{}',
  lc_tags text[] not null default '{}',
  paid_only boolean not null default false,
  ac_rate real,
  target_minutes int,
  neetcode_link text
);

create table public.topics (
  name text primary key,
  ord int not null,
  tier int not null,
  prereqs text[] not null default '{}',
  lc_tags text[] not null default '{}'
);

create table public.settings (
  owner uuid not null default auth.uid() primary key,
  nudge_times text[] not null default '{10:00,18:00,22:00}',
  daily_lc_count int not null default 6 check (daily_lc_count between 5 and 8),
  weekly_app_target int not null default 25,
  ntfy_topic text,
  resume_root text not null default '~/Desktop/Adam_Kuhn_Resumes',
  sheet_id text,
  lc_username text not null default 'adamkuhn',
  lc_started_on date,
  lc_focus_topic text,
  lc_focus_since date,
  app_url text
);

create table public.lc_solves (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid(),
  slug text not null,
  title text not null,
  accepted_at timestamptz not null,
  rating text check (rating in ('nailed','struggled','help')),
  rated_at timestamptz,
  effective_rating text check (effective_rating in ('nailed','struggled','help')),
  slot text check (slot in ('new','review','mystery','spot')),
  interval_before int,
  applied_at timestamptz,
  note text,
  unique (owner, slug, accepted_at)
);

create table public.lc_problem_state (
  owner uuid not null default auth.uid(),
  slug text not null,
  state text not null check (state in ('new','learning','reviewing','retained','parked')),
  interval_days int not null default 0,
  due_on date,
  lapses int not null default 0,
  primary key (owner, slug)
);

create table public.lc_topic_state (
  owner uuid not null default auth.uid(),
  topic text not null,
  level text not null check (level in ('locked','available','learning','practicing','solid','mastered')),
  updated_at timestamptz not null default now(),
  primary key (owner, topic)
);

create table public.lc_daily_sets (
  owner uuid not null default auth.uid(),
  day date not null,
  focus text not null,
  mixed_day boolean not null default false,
  items jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner, day)
);

create table public.lc_tag_counts (
  owner uuid not null default auth.uid(),
  tag text not null,
  solved int not null,
  synced_at timestamptz not null,
  primary key (owner, tag)
);

create table public.projects (
  id text not null,
  owner uuid not null default auth.uid(),
  name text not null,
  repo text not null,
  local_path text,
  active boolean not null default true,
  primary key (owner, id)
);

create table public.commits (
  owner uuid not null default auth.uid(),
  sha text not null,
  project_id text not null,
  message text not null,
  committed_at timestamptz not null,
  primary key (owner, sha)
);

create table public.ideas (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  project_id text not null,
  text text not null,
  size text not null default 'S' check (size in ('S','M')),
  status text not null default 'todo' check (status in ('todo','today','done','dropped')),
  source text not null default 'me' check (source in ('me','claude')),
  position int not null default 0,
  today_on date,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.applications (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid(),
  company text not null,
  role text,
  track text,
  term text,
  location text,
  status text,
  stage text not null,
  priority text,
  applied_on date,
  row_hash text not null
);

create table public.postings (
  owner uuid not null default auth.uid(),
  id text not null,
  company text not null,
  title text not null,
  location text,
  url text,
  term text,
  posted_at timestamptz,
  tier text,
  starred boolean not null default false,
  status text not null default 'new' check (status in ('new','seen','dismissed','outreach')),
  found_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.outreach (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  job_url text not null,
  company text,
  role text,
  resume_path text,
  status text not null default 'queued' check (status in ('queued','drafted','sent','replied','closed')),
  sent_on date,
  follow_up_on date,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.contacts (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  outreach_id uuid not null,
  name text not null,
  title text,
  linkedin_url text,
  email_guess text,
  email_confidence text check (email_confidence in ('verified','pattern','guess')),
  why text,
  draft_subject text,
  draft_body text,
  primary key (owner, id)
);

create table public.launch_requests (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  kind text not null check (kind in ('outreach','suggest_ideas')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','launched','failed')),
  error text,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.sync_status (
  owner uuid not null default auth.uid(),
  source text not null,
  last_ok_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  failing_since timestamptz,
  alerted_on date,
  primary key (owner, source)
);

create table public.worker_state (
  owner uuid not null default auth.uid(),
  key text not null,
  value jsonb not null,
  primary key (owner, key)
);

-- RLS
alter table public.problems enable row level security;
alter table public.topics enable row level security;
create policy problems_read on public.problems for select to authenticated using (true);
create policy topics_read on public.topics for select to authenticated using (true);

alter table public.settings enable row level security;
create policy settings_owner on public.settings for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.lc_solves enable row level security;
create policy lc_solves_owner on public.lc_solves for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.lc_problem_state enable row level security;
create policy lc_problem_state_owner on public.lc_problem_state for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.lc_topic_state enable row level security;
create policy lc_topic_state_owner on public.lc_topic_state for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.lc_daily_sets enable row level security;
create policy lc_daily_sets_owner on public.lc_daily_sets for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.lc_tag_counts enable row level security;
create policy lc_tag_counts_owner on public.lc_tag_counts for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.projects enable row level security;
create policy projects_owner on public.projects for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.commits enable row level security;
create policy commits_owner on public.commits for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.ideas enable row level security;
create policy ideas_owner on public.ideas for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.applications enable row level security;
create policy applications_owner on public.applications for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.postings enable row level security;
create policy postings_owner on public.postings for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.outreach enable row level security;
create policy outreach_owner on public.outreach for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.contacts enable row level security;
create policy contacts_owner on public.contacts for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.launch_requests enable row level security;
create policy launch_requests_owner on public.launch_requests for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.sync_status enable row level security;
create policy sync_status_owner on public.sync_status for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table public.worker_state enable row level security;
create policy worker_state_owner on public.worker_state for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
