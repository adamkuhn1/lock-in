# Lock In setup

These are the one-time setup steps. Never paste keys into chat or commit them: secrets go from your own terminal straight into `gh secret set`, the Supabase SQL editor, or the macOS Keychain.

## 1. Supabase project (backend)

1. Install the CLI with `brew install supabase/tap/supabase`, then run `supabase login`. The browser opens and you sign in yourself.
2. Run `supabase projects list`. The free plan allows 2 active projects. If two are already active, stop and decide which to pause. Promotr is never touched.
3. Create the project and apply the schema:
   ```bash
   supabase orgs list
   supabase projects create lock-in --org-id <org> --region us-east-1 --db-password "$(openssl rand -base64 24)"
   supabase link --project-ref <ref>
   supabase db push          # applies 0001_init.sql and 0002_trigger.sql (idempotent)
   ```
4. Create your user and turn off sign-ups:
   - Dashboard → Authentication → Users → Add user (your email, auto-confirm). Copy the user's UUID.
   - Authentication → Sign In / Providers → turn off "Allow new users to sign up".
5. Verify the table grants in the SQL editor:
   ```sql
   select grantee, table_name, privilege_type
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('authenticated', 'service_role');
   ```
   You should see SELECT/INSERT/UPDATE/DELETE for both roles on all 18 tables (72 rows per role). RLS still limits `authenticated` to your own rows, and makes `problems`/`topics` read-only.

## 2. Google Sheet access (read-only)

1. In console.cloud.google.com, create a project named "lock-in" and enable the **Google Sheets API**.
2. IAM → Service Accounts → Create. Then Keys → Add key → JSON, which saves a file to `~/Downloads`.
3. In the Sheet, click Share, add the service account's `client_email`, and set it to **Viewer**.

## 3. GitHub repo and secrets

```bash
gh repo create adamkuhn1/lock-in --private --source . --push
gh secret set SUPABASE_URL           # https://<ref>.supabase.co
gh secret set SUPABASE_SERVICE_KEY   # Settings → API → service_role
gh secret set LOCKIN_OWNER_ID        # UUID from step 1.4
gh secret set NTFY_TOPIC             # the topic your phone already subscribes to
gh secret set SHEET_ID --body 1Iq2PHFtzhwDokzWjlRndeAw1RSsEZpgKEoLGGE2iaDI
gh secret set GOOGLE_SA_JSON < ~/Downloads/<key>.json && rm ~/Downloads/<key>.json
gh secret set LOCKIN_GH_TOKEN        # only if 27b or showboat is private: fine-grained PAT, Contents: read on those repos
```

## 4. Seed the database

```bash
cd worker
export SUPABASE_URL=https://<ref>.supabase.co LOCKIN_OWNER_ID=<uuid> NTFY_TOPIC=<topic> SHEET_ID=1Iq2PHFtzhwDokzWjlRndeAw1RSsEZpgKEoLGGE2iaDI
read -s SUPABASE_SERVICE_KEY && export SUPABASE_SERVICE_KEY
.venv/bin/python -m lockin_worker.seed   # → {'problems': 420, 'topics': 18, 'projects': 2}
```

## 5. Reliable 30-minute trigger

GitHub's scheduled cron is best effort. On this account, job-radar's every-30-minutes schedule actually ran 4–6 times a day, with gaps of up to 10 hours. Supabase `pg_cron` now starts the sync workflow every 30 minutes, and GitHub's `schedule:` stays as a backup. The workflow's concurrency group keeps runs from overlapping.

1. Create a **fine-grained personal access token** on GitHub:
   - Resource owner: adamkuhn1.
   - Repository access: only `adamkuhn1/lock-in`.
   - Permissions: **Actions → Read and write**, nothing else.
   - Set an expiry and add a calendar reminder to rotate it.
2. Store it in Supabase Vault. Paste the token yourself in the SQL editor:
   ```sql
   select vault.create_secret('<token>', 'lockin_dispatch_token');
   -- to rotate later:
   select vault.update_secret((select id from vault.secrets where name = 'lockin_dispatch_token'), '<new token>');
   ```
3. Verify:
   ```sql
   select * from cron.job where jobname = 'lockin-sync';
   select * from cron.job_run_details order by start_time desc limit 5;
   select * from net._http_response order by created desc limit 5;   -- expect status_code 204
   ```
   Then run `gh run list --workflow sync`. Runs started this way show the event `workflow_dispatch`.
4. To pause it, run `select cron.unschedule('lockin-sync');`.

**Actions minutes:** 48 runs a day at ≥1 billed minute each is about 1,440 minutes a month on a private repo. The free plan includes 2,000. Keep each run under 60 seconds, and check with `gh run list --workflow sync --json databaseId,createdAt,updatedAt,event --limit 20`. If minutes get tight, widen the schedule to `'7 * * * *'`.

## 6. First run

```bash
gh workflow run sync && gh run watch
```

The logs should show counts for `leetcode`, `github`, `sheet` (about 80 rows) and `jobs` (seeded). Then check Supabase:
- `lc_daily_sets` has today's row with 6 items.
- `sync_status` has no failures.

If the run happens after 10:00 ET, "Today's plan" arrives on your phone. A second run must not send it again.
