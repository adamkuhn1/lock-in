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
