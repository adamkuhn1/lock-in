-- Lock In v3: engineer outreach (LinkedIn referral notes), posting tiers, reply tracking, radar filtering. Idempotent.

-- ---- Tiers: reach | volume | midwest (worker/config/companies.yaml explains each) ----
-- Old letter tiers: A was "top targets", which is now reach; B and C become volume. The worker re-tiers every open
-- posting on its next run (including Midwest locations), so this only has to make the old rows valid.
update public.postings set tier = case tier when 'A' then 'reach' when 'B' then 'volume' when 'C' then 'volume' else tier end
  where tier in ('A', 'B', 'C');
update public.postings set tier = 'volume' where tier is null or tier not in ('reach', 'volume', 'midwest');
alter table public.postings drop constraint if exists postings_tier_check;
alter table public.postings add constraint postings_tier_check check (tier is null or tier in ('reach', 'volume', 'midwest'));

-- The sheet sync tags each application with its company's tier; the worker backfills outreach.
alter table public.applications add column if not exists tier text;
alter table public.outreach add column if not exists tier text;
-- Replied is a date now, so reply rates can be counted by week and tier. Old replied rows keep a null date.
alter table public.outreach add column if not exists replied_on date;

-- ---- Radar filtering: postings the worker drops after reading the full posting stay visible as 'filtered' ----
-- filtered_reason: one line, e.g. "Needs 3+ years of experience" or "Trading firm".
alter table public.postings add column if not exists filtered_reason text;
alter table public.postings drop constraint if exists postings_status_check;
alter table public.postings add constraint postings_status_check
  check (status in ('new', 'seen', 'dismissed', 'outreach', 'applied', 'filtered'));

-- Proprietary trading firms, market makers and quant funds leave the inbox. Applications to them are untouched.
update public.postings set status = 'filtered', filtered_reason = 'Trading firm'
  where status in ('new', 'seen')
    and company ~* '(jane street|citadel|hudson river trading|optiver|imc trading|akuna|^drw|chicago trading company|susquehanna|jump trading|five rings|two sigma|tower research|maven securities|edgehog|belvedere trading|old mission|xtx|squarepoint|flow traders|geneva trading|virtu|point72)';

-- ---- Settings ----
alter table public.settings add column if not exists weekly_engineer_target int not null default 10;
alter table public.settings drop constraint if exists settings_weekly_engineer_target_check;
alter table public.settings add constraint settings_weekly_engineer_target_check check (weekly_engineer_target between 1 and 100);
-- Phone alert for each new reach or Midwest posting (volume postings roll into one summary). Off until job-radar's
-- own alerts are retired (docs/setup.md step 8), so nothing alerts twice.
alter table public.settings add column if not exists job_alerts boolean not null default false;

-- ---- Engineer outreach: one row per engineer Claude suggests for a job ----
-- Claude finds them with public web search and drafts a LinkedIn connection note; Adam sends it himself.
--   pick:   why this person ranks first: ex_apple, then cmu (Central Michigan alumni), then team (same team or stack)
--   status: drafted -> sent -> accepted -> replied -> referred (closed = no longer pursuing)
--   followed_up_on: the message sent 3-4 days after they accepted
create table if not exists public.referrals (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  request_id uuid,
  posting_id text,
  job_url text,
  company text not null,
  role text,
  tier text check (tier is null or tier in ('reach', 'volume', 'midwest')),
  name text not null,
  title text,
  profile_url text,
  pick text not null default 'other' check (pick in ('ex_apple', 'cmu', 'team', 'other')),
  why text,
  note text not null check (char_length(note) <= 280),
  status text not null default 'drafted' check (status in ('drafted', 'sent', 'accepted', 'replied', 'referred', 'closed')),
  sent_on date,
  accepted_on date,
  followed_up_on date,
  replied_on date,
  referred_on date,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);
alter table public.referrals enable row level security;
drop policy if exists referrals_owner on public.referrals;
create policy referrals_owner on public.referrals for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create index if not exists referrals_company on public.referrals (owner, company);

alter table public.launch_requests drop constraint if exists launch_requests_kind_check;
alter table public.launch_requests add constraint launch_requests_kind_check
  check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview','tailor_resume','best_fit','report','find_engineers'));

-- ---- Activity: a LinkedIn note sent counts as outreach for the day, like a recruiter email ----
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

-- ---- Faster job scans: a jobs-only workflow every 10 minutes between the full syncs (:07 and :37) ----
create or replace function public.trigger_jobs() returns void
language plpgsql security definer set search_path = public, extensions as $$
  declare tok text;
  begin
    select decrypted_secret into tok from vault.decrypted_secrets where name = 'lockin_dispatch_token';
    if tok is null then raise notice 'lockin_dispatch_token not set'; return; end if;
    perform net.http_post(
      url := 'https://api.github.com/repos/adamkuhn1/lock-in/actions/workflows/jobs.yml/dispatches',
      headers := jsonb_build_object('Authorization', 'Bearer ' || tok,
                                    'Accept', 'application/vnd.github+json',
                                    'User-Agent', 'lock-in-pgcron',
                                    'X-GitHub-Api-Version', '2022-11-28'),
      body := jsonb_build_object('ref', 'main'));
  end $$;
revoke all on function public.trigger_jobs() from public, anon, authenticated;
select cron.unschedule('lockin-jobs') where exists (select 1 from cron.job where jobname='lockin-jobs');
select cron.schedule('lockin-jobs', '17,27,47,57 * * * *', 'select public.trigger_jobs()');

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.day_activity to authenticated, service_role;
