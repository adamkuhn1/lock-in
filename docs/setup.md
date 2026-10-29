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

## 7. Mac launcher and `lockin` CLI

When you tap **Cold email** or **Suggest improvements** in the app, the launcher opens Terminal with Claude Code.

1. **Store the credentials:** run `make keychain`. macOS's `security` tool asks for each value with the input hidden, so nothing appears on screen or in the process list. Enter:
   - the Supabase URL
   - the service-role key (Supabase → Settings → API)
   - your user id (`LOCKIN_OWNER_ID`, the same value as the GitHub secret)
2. **Install:** run `make install-launcher`. This creates `~/.lockin/venv`, links `~/.local/bin/lockin`, writes `~/Library/LaunchAgents/com.adamkuhn.lockin.launcher.plist` and starts it.
3. **Check:**
   - `~/.lockin/venv/bin/lockin doctor` should print `OK: connected to Supabase, 0 queued launch requests`.
   - In a new Terminal window, `claude --version` and `command -v lockin` should both work. If `lockin` isn't found, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc`.
4. **Grant macOS permissions once.** Queue a Cold email from the app.
   - macOS asks whether **Python** (the binary behind `~/.lockin/venv`; the prompt may say "python3.12") can control **Terminal**. Allow it.
   - It may also ask for **Desktop** folder access, since the resume folders live there. Allow it.
   - If you missed a prompt, go to System Settings → Privacy & Security → **Automation** and **Files and Folders**. If no prompt appears, add that Python to **Full Disk Access**.
   - A Homebrew Python upgrade can reset these grants. Re-allow them if launches start failing.
5. **Claude Code approvals:**
   - Approve only the exact command `~/.lockin/venv/bin/lockin save-outreach …` / `save-ideas …` when Claude asks. Don't give Claude broad Bash permission in these sessions: the outreach prompt reads web pages that could try to slip in commands.
   - Outreach sessions run in `~/.lockin/outreach`, not your home folder.
6. **Day to day:**
   - `make launcher-status` shows status and logs.
   - After pulling new code, run `make restart-launcher`.
   - To remove it, run `make uninstall-launcher`.
   - Don't also run `lockin-launcher` by hand while the agent is loaded.

How it behaves:
- The launcher checks for requests every 10 seconds.
- A request is marked `launched` before Terminal opens, so it never opens twice. Failures show in the app with the error.
- While the Mac is off, requests wait as "Queued for Mac".
- If the login keychain is locked, the launcher logs "locked or unreadable" and keeps waiting.

## 8. Retire job-radar's per-posting alerts (only with Adam's OK)

Do this only after `gh run list --workflow sync` shows 24 hours of clean runs:

```bash
gh workflow disable radar.yml -R adamkuhn1/job-radar
```

Then add a note to the job-radar README saying the code now lives in `lock-in/worker/job_radar`.

## 9. Web app (Vercel)
Done together in the setup session. Nothing here is automated.

1. **Supabase auth settings** (Dashboard → Authentication):
   - URL Configuration → Site URL: `https://<project>.vercel.app`; Redirect URLs: add the same URL and `http://localhost:5173`.
   - Email Templates → Magic Link: include the code so the iPhone home-screen app can sign in without leaving itself:
     `<p>Your Lock In code: <strong>{{ .Token }}</strong></p><p><a href="{{ .ConfirmationURL }}">Or sign in with this link</a></p>`
   - Sign-ups stay disabled (Plan 1 Task 12).
2. **Create the Vercel project** (Hobby): vercel.com → Add New → Project → import `adamkuhn1/lock-in`.
   - Root Directory: `web`. Keep "Include files outside the root directory in the Build Step" **on** (the app imports `../prompts/outreach.md`).
   - Framework: Vite (auto-detected from `web/vercel.json`).
   - Environment variables (Production and Preview), all from Supabase → Settings → API:
     `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (browser, build-time), `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the `/api/sync-leetcode` and `/api/sheet` functions), and for Sheet writes `GOOGLE_SA_JSON`, `SHEET_ID`, `LOCKIN_OWNER_ID` (server-only; see §10). Never add the service-role key here.
3. **Author check before the first push** (Vercel Hobby blocks other authors): `git log -1 --format='%an <%ae>'` must print `adamkuhn1 <184679495+adamkuhn1@users.noreply.github.com>`. Don't change git config; if it differs, stop and ask.
4. **Deploy**: pushing to the default branch deploys. Open the URL, sign in with the emailed code.
5. **Tell the worker the URL**: in the app, Settings → Mac → App URL = the Vercel URL (nudges open it when tapped).
6. **Install**: iPhone Safari → Share → Add to Home Screen, open it, sign in with the code. Mac: Safari → File → Add to Dock (or Chrome → Install Lock In).
7. **Check sync on open**: solve any problem on LeetCode, open the app, tap Refresh: the matching item in today's set checks itself off within a few seconds (if it isn't in today's set, it shows under LeetCode → History).

Local development: `cd web && npm run dev:demo` (fixture data, no Supabase). Against the real project: copy `.env.example` to `.env.local`, fill the `VITE_` values, `npm run dev`. `/api/sync-leetcode` only runs under `vercel dev` or on Vercel; under plain `npm run dev` the refresh button quietly reports an error and everything else works.

Notes: set `settings.app_url` (step 5) so ntfy taps open the app. If the Mac Add to Dock option is missing, use Safari 17+.
vercel.json ships only conservative headers (nosniff, Referrer-Policy, no-cache on /sw.js); no CSP, to avoid breaking the service worker or Supabase calls.

## 10. v2 (2026-10-14)
- Migration `0003_v2.sql` is applied (prep, calendar, `day_activity` view); `shared/prep_items.json` is loaded into `prep_items`; LEGO is a project with no repo. Link it in Me → Settings → Projects → Edit LEGO once `adamkuhn1/lego` exists.
- **Deploying the web app:** automatic. `.github/workflows/deploy.yml` deploys a git-free copy after `ci` passes on a push to `main` (secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; run it by hand from the Actions tab). Git-free because this Vercel account isn't linked to the `adamkuhn1` GitHub identity, so Hobby blocks deploys that carry git metadata ("commit author doesn't have permission"). To deploy from the Mac instead:
  ```bash
  D=$(mktemp -d) && git archive main | tar -x -C "$D" && mkdir "$D/.vercel" && cp .vercel/project.json "$D/.vercel/"
  (cd "$D" && VERCEL_TOKEN="$(security find-generic-password -s lockin -a vercel_token -w)" npx -y vercel@64.0.2 deploy --prod --yes)
  ```
- **Ship order** when the schema changes: migrate → `make restart-launcher` → push `main` → data inserts → Vercel deploy.
- **Work on this / Mock with Claude** use the same Mac permissions as Cold email. An idea is marked done when a commit made after you tapped the button reaches the project's main branch on GitHub (or tick it done in the app).
- **Profile** (Me tab): migration `0008_profile.sql` adds `settings.profile` (applied 2026-10-19). The Tailor resume and Cold email prompts, including their fit check, read it through `worker/lockin_worker/profile.py` and `web/src/lib/profile.ts`; blank fields fall back to `shared/profile_defaults.json`, and `shared/profile-cases.json` keeps the two renderers identical.
- **Plain idea titles** (Suggest improvements): apply migration `0007_idea_details.sql` before the worker update. Claude saves a plain-English `text` for the app and a technical `details` brief that Work on this hands to Claude Code; `save-ideas` fails until the column exists.
- **Tailor resume** (Hunt → Jobs): apply migration `0004_tailor.sql` and run `make restart-launcher` first. It needs the same Terminal Desktop access as Cold email, plus `tectonic` (installed at `/opt/homebrew/bin/tectonic`) and `Base_Resume/Adam_Kuhn_Resume.tex` and `.pdf` inside the resume root (default `~/Desktop/Adam_Kuhn_Resumes`). Claude works in `~/.lockin/tailor/<job>`, saves the tailored PDF and .tex into a new folder next to the others, opens the posting, and drafts one recruiter email.
- **Open in Outlook** (Hunt → Outreach) opens a prefilled email in the default mail app. Make Outlook the default once: Outlook → Settings → General → Default email app. The card's "Resume:" line is the file to attach.
- **Write to the Sheet** (Hunt → Jobs/Outreach **I applied**, Hunt → Applications **Status**): roll out in this order:
  1. **Apply migration `0005_sheet_writes.sql`** in the Supabase SQL editor (adds `applications.sheet_row` and the `applied` posting status). This must come **before the worker update**: the new worker inserts `sheet_row`, and the 30-minute sheet sync fails on every run until the column exists.
  2. **Worker update:** merge to `main` (the GitHub Actions sync runs the new worker) and run `make restart-launcher` on the Mac. Let one sync run so rows get their `sheet_row`.
  3. **Vercel env vars** (below), then **deploy the web app**. The web app also works before 0005 (it reads `sheet_row` only if the column exists), but `/api/sheet` and "I applied" need 0005, because `postings.status = 'applied'` is rejected without it.

  In Vercel (Production and Preview) add these **server-only** env vars (never `VITE_`-prefixed): `GOOGLE_SA_JSON` (the service-account key JSON, one line; the account needs Editor on the Sheet), `SHEET_ID` (the only Sheet `/api/sheet` will ever write) and `LOCKIN_OWNER_ID` (your Supabase user id, the same value as the GitHub secret). Without all three, `/api/sheet` refuses with "Sheet writes aren't configured." and only `LOCKIN_OWNER_ID` may write. The Status picker shows exactly the options in the Sheet's Status dropdown, so add new wording (e.g. "Rejected after OA", "Rejected after interview") to the dropdown in the Sheet first; if the Status column has no dropdown, the picker is hidden.

## 11. v3 (2026-10-28): engineer outreach, tiers, faster job scans

Deploy in this order. The new worker writes columns that only exist after the migration.

1. Run `supabase/migrations/0011_engineers_tiers.sql` in the SQL editor. It re-tiers postings, adds the `referrals` table and the reply dates, files trading-firm postings out of the inbox (applications to them are untouched), and schedules `lockin-jobs`, a jobs-only scan at :17, :27, :47 and :57.
2. Restart the launcher so it knows `find_engineers`: `launchctl kickstart -k gui/$(id -u)/com.lockin.launcher`.
3. Push to main. `jobs.yml` must be on main before pg_cron dispatches it; until then those dispatches fail harmlessly.
4. Check: `select * from cron.job where jobname = 'lockin-jobs';` and, after ~10 minutes, `gh run list --workflow jobs`.
5. Phone alerts for new postings: once job-radar's own alerts are off (step 8), turn on **Me → Settings → Phone alert for each new Reach or Midwest posting**. Until then they stay off so nothing alerts twice.

The first scan after the migration re-tiers and re-checks the whole open inbox, so expect a burst of postings under Jobs → Filtered. Anything there can be restored, and the scanner won't file a restored posting again.
