-- Lock In: reliable sync trigger + explicit grants.
-- GitHub's `schedule:` cron is best-effort (observed gaps of up to 10h on this account), so pg_cron
-- dispatches the sync workflow every 30 min. The GitHub schedule stays in sync.yml as a backup; the
-- workflow's concurrency group prevents overlapping runs.
-- Requires a vault secret named 'lockin_dispatch_token' (fine-grained PAT, adamkuhn1/lock-in,
-- "Actions: Read and write" only). See docs/setup.md. Without it trigger_sync() is a no-op notice.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_sync() returns void
language plpgsql security definer set search_path = public, extensions as $$
  declare tok text;
  begin
    select decrypted_secret into tok from vault.decrypted_secrets where name = 'lockin_dispatch_token';
    if tok is null then raise notice 'lockin_dispatch_token not set'; return; end if;
    perform net.http_post(
      url := 'https://api.github.com/repos/adamkuhn1/lock-in/actions/workflows/sync.yml/dispatches',
      headers := jsonb_build_object('Authorization', 'Bearer ' || tok,
                                    'Accept', 'application/vnd.github+json',
                                    'User-Agent', 'lock-in-pgcron',
                                    'X-GitHub-Api-Version', '2022-11-28'),
      body := jsonb_build_object('ref', 'main'));
  end $$;

revoke all on function public.trigger_sync() from public, anon, authenticated;

-- Idempotent: re-running the migration replaces the job instead of erroring/duplicating.
select cron.unschedule('lockin-sync') where exists (select 1 from cron.job where jobname='lockin-sync');
select cron.schedule('lockin-sync', '7,37 * * * *', 'select public.trigger_sync()');

-- Explicit grants (Supabase normally sets these via default privileges; make it certain).
-- RLS still restricts `authenticated` to its own rows, and problems/topics to select-only policies.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
