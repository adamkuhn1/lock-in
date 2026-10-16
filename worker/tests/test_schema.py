import re
from pathlib import Path

SQL = (Path(__file__).parents[2] / "supabase/migrations/0001_init.sql").read_text()
GLOBAL = {"problems", "topics"}

def tables():
    return re.findall(r"create table public\.(\w+)", SQL)

def test_every_owned_table_has_owner_and_rls():
    found = tables()
    assert len(found) >= 18
    for t in found:
        assert f"alter table public.{t} enable row level security" in SQL, t
        if t not in GLOBAL:
            block = SQL.split(f"create table public.{t}")[1].split(");")[0]
            assert "owner uuid not null default auth.uid()" in block, t
            assert f"create policy {t}_owner on public.{t}" in SQL, t

def test_global_tables_are_read_only_for_users():
    for t in GLOBAL:
        assert f"create policy {t}_read on public.{t} for select to authenticated using (true)" in SQL


TRIGGER = Path(__file__).parents[2] / "supabase/migrations/0002_trigger.sql"

def test_trigger_migration_schedules_dispatch_and_grants():
    sql = TRIGGER.read_text()
    assert "create table" not in sql  # 0002 adds no tables; table/RLS checks above cover 0001 only
    assert "create extension if not exists pg_cron" in sql and "create extension if not exists pg_net" in sql
    assert "create or replace function public.trigger_sync()" in sql and "security definer" in sql
    assert "name = 'lockin_dispatch_token'" in sql
    assert "repos/adamkuhn1/lock-in/actions/workflows/sync.yml/dispatches" in sql
    assert "revoke all on function public.trigger_sync() from public, anon, authenticated" in sql
    # idempotent re-run: unschedule only if present, then schedule off the :00/:30 peak
    assert "select cron.unschedule('lockin-sync') where exists (select 1 from cron.job where jobname='lockin-sync')" in sql
    assert sql.index("cron.unschedule") < sql.index("cron.schedule('lockin-sync', '7,37 * * * *'")
    assert "grant usage on schema public to authenticated, service_role" in sql
    assert "grant select, insert, update, delete on all tables in schema public to authenticated, service_role" in sql


V2 = (Path(__file__).parents[2] / "supabase/migrations/0003_v2.sql").read_text()
V2_OWNED = ["stories", "prep_sessions", "prep_progress", "company_prep", "events"]


def test_v2_new_owner_tables_have_owner_and_rls():
    for t in V2_OWNED:
        assert f"create table if not exists public.{t}" in V2, t
        block = V2.split(f"create table if not exists public.{t}")[1].split(");")[0]
        assert "owner uuid not null default auth.uid()" in block, t
        assert f"alter table public.{t} enable row level security" in V2, t
        assert f"create policy {t}_owner on public.{t} for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid())" in V2, t


def test_v2_prep_items_is_global_read_only():
    assert "create table if not exists public.prep_items" in V2
    assert "alter table public.prep_items enable row level security" in V2
    assert "create policy prep_items_read on public.prep_items for select to authenticated using (true)" in V2


def test_v2_alters_existing_tables():
    assert "add column if not exists day_one date not null default '2026-09-28'" in V2
    assert "add column if not exists weekly_email_target int not null default 10" in V2
    assert "alter column repo drop not null" in V2
    assert "add column if not exists started_at timestamptz" in V2
    assert "check (status in ('todo','today','in_progress','done','dropped'))" in V2
    assert "check (kind in ('outreach','suggest_ideas','work_on_idea','mock_interview'))" in V2
    assert "check (tags <@ array['leadership','conflict','failure','impact','teamwork']::text[])" in V2


def test_v2_day_activity_view_is_security_invoker_and_granted():
    assert "create or replace view public.day_activity with (security_invoker = true)" in V2
    assert "interval '4 hours'" in V2 and "America/Detroit" in V2
    assert "grant select on public.day_activity to authenticated, service_role" in V2
    assert "grant select, insert, update, delete on all tables in schema public to authenticated, service_role" in V2


def test_v2_day_activity_uses_instant_shift_like_plan_day():
    # Subtract 4 h from the instant, then take the Detroit date (DST-safe), as clock.plan_day does.
    for col in ("now()", "accepted_at", "committed_at"):
        assert f"(({col} - interval '4 hours') at time zone 'America/Detroit')::date" in V2
        assert f"(({col} at time zone 'America/Detroit') - interval '4 hours')" not in V2


TAILOR = Path(__file__).parents[2] / "supabase/migrations/0004_tailor.sql"


def test_tailor_migration_adds_launch_kind_idempotently():
    sql = TAILOR.read_text()
    assert "drop constraint if exists launch_requests_kind_check" in sql
    assert ("add constraint launch_requests_kind_check check "
            "(kind in ('outreach','suggest_ideas','work_on_idea','mock_interview','tailor_resume'))") in sql


SHEET_WRITES = Path(__file__).parents[2] / "supabase/migrations/0005_sheet_writes.sql"


def test_sheet_writes_migration_adds_sheet_row_and_applied_status_idempotently():
    sql = SHEET_WRITES.read_text()
    assert "create table" not in sql
    assert "alter table public.applications add column if not exists sheet_row int" in sql
    assert "drop constraint if exists postings_status_check" in sql
    assert ("add constraint postings_status_check check "
            "(status in ('new','seen','dismissed','outreach','applied'))") in sql
    assert sql.index("drop constraint if exists postings_status_check") < sql.index("add constraint postings_status_check")
    # 0001's inline check is auto-named <table>_<column>_check, which is the name dropped here.
    assert "status text not null default 'new' check (status in ('new','seen','dismissed','outreach'))" in SQL


FOLLOWUPS = Path(__file__).parents[2] / "supabase/migrations/0006_followups.sql"


def test_followups_migration_adds_count_idempotently():
    sql = FOLLOWUPS.read_text()
    assert "create table" not in sql
    assert "alter table public.outreach add column if not exists followups int not null default 0" in sql


IDEA_DETAILS = Path(__file__).parents[2] / "supabase/migrations/0007_idea_details.sql"


def test_idea_details_migration_is_idempotent():
    sql = IDEA_DETAILS.read_text()
    assert "create table" not in sql
    assert "alter table public.ideas add column if not exists details text" in sql
