# Lock In: design spec

Date: 2026-10-14 · Owner: Adam Kuhn · Status: awaiting Adam's review

## 1. Purpose

Adam is a CS student at Central Michigan University. He graduates in May 2027 and wants a winter or spring 2027 internship. If the internship is good enough, he will push graduation back to December 2027. CMU is a non-target school in a weak networking area, so cold outreach and daily consistency matter more for him than they would at a target school.

Lock In is a private app Adam opens every day on his phone and his Mac. It tells him what to do today, tracks whether he did it, and nudges him when he hasn't.

**It succeeds when:**
- Adam opens it daily, and the Today screen can be understood in about 5 seconds.
- LeetCode, project and application streaks are tracked without manual bookkeeping wherever an API makes that possible.
- Cold-email outreach from a job URL takes one paste plus a review of the drafts.
- It keeps working 24/7 when the Mac is off. The only exception is the Claude Code launch, which needs the Mac.

**UX principle (Adam's words: "it's pointless if it's confusing, overly wordy"):** each screen has one primary thing. Details sit behind a tap, copy is short, and nothing shows unless it is actionable today. Use the available design skills (frontend-design, better-interface and the better-* family, web-design-guidelines) and a screenshot review loop at phone and desktop widths.

## 2. Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Form factor | Hosted PWA, installed to the iPhone home screen and the Mac Dock. Native Swift was rejected because it needs a backend anyway, costs $99/yr to keep on the phone, and is the most work. |
| Always-on behavior | Dashboard plus nudges (option B), plus job polling moved in from job-radar. |
| Google Sheet | **Read-only.** Adam edits the sheet himself; the app only displays it, and displays it better. |
| LeetCode input | Auto-sync of username `adamkuhn` from LeetCode's public API, plus a one-tap rating per solve. |
| Recommendations | A curated problem bank from research (`docs/research/`), with the topic roadmap and mastery model in §6. |
| Projects | Commit tracking, an idea list per project, and a "Suggest improvements" button that opens Claude Code. |
| Outreach | Claude Code drafts contacts and emails. The results are saved to the app with follow-up reminders. Nothing is ever sent automatically. |
| Resume | Uses Adam's existing folders in `~/Desktop/Adam_Kuhn_Resumes/` (per-job folders plus `Base_Resume/`). |
| Notifications | ntfy only. job-radar's per-posting pushes are retired; new postings are summarized inside the nudges. |
| Isolation | New repo and a new Supabase project. Nothing shared with Promotr. |

## 3. Architecture

```
iPhone (home-screen PWA)      Mac (Dock PWA)   ── launcher (login item) ──► Terminal: claude "<prompt>"
        └────────────┬──────────────┘                        ▲ polls launch_requests
                     ▼                                       │
          Vercel: web/ (React + Vite + TS)  ◄──────►  Supabase (Postgres + Auth + RLS)
                                                             ▲
          GitHub Actions cron */30 ──► worker/ (Python) ─────┘
             ├─ jobs: job-radar fetchers + filters ──► postings
             ├─ leetcode: recent AC + tag counts   ──► lc_solves, lc_tag_counts
             ├─ github: commits for tracked repos  ──► commits
             ├─ sheet: Applications tab            ──► applications (replaced on each sync)
             └─ nudges at 10:00 / 18:00 / 22:00 ET ──► ntfy
```

**Repo `adamkuhn1/lock-in`** (private), monorepo:
- `web/`: React 19, Vite, TypeScript (strict), and a PWA manifest plus a service worker so it can be installed. Talks to Supabase through `@supabase/supabase-js`. Deployed to Vercel Hobby. Commits must be authored as `adamkuhn1 <184679495+adamkuhn1@users.noreply.github.com>`, or Vercel Hobby blocks the deploy.
- `worker/`: Python 3.12 package `lockin_worker`. Run by `.github/workflows/sync.yml` on `*/30 * * * *` and on `workflow_dispatch`. Writes with the Supabase service-role key, which lives only in GitHub Actions secrets.
- `launcher/`: a small Python script installed as a macOS LaunchAgent. It needs no deploy.
- `cli/`: the `lockin` command that Claude Code calls to save results (`lockin save-outreach`, `lockin save-ideas`). Python, installed on the Mac with `pipx install -e`.
- `docs/research/`: `problems.json` (420 problems), `roadmap.json` (18 topics) and `leetcode-research.md`.

**Auth:** Supabase Auth email magic link. RLS on every table allows only Adam's `auth.uid()`, which is pinned through an `owner` column defaulting to `auth.uid()` plus a single allowed-email check in the sign-up hook. The worker uses the service role. The launcher and the CLI use a long-lived personal refresh token stored in the macOS Keychain.

**Cost:** $0. Vercel Hobby, Supabase free tier (a separate project; confirm a free slot is open before creating it), GitHub Actions free minutes, and ntfy.sh.

## 4. Data model (Supabase Postgres)

Every table has `owner uuid` with RLS `owner = auth.uid()`. Times are stored as `timestamptz`, and "today" is computed in `America/Detroit`.

| Table | Key columns |
|---|---|
| `settings` | nudge_times[], daily_lc_count (5–8, default 6), weekly_app_target (default 25), ntfy_topic, resume_root, sheet_id, lc_username |
| `problems` | slug PK, title, difficulty, topic, lists[], lc_tags[], paid_only, ac_rate, target_minutes. Seeded from `problems.json`. |
| `topics` | slug PK, name, tier, prereqs[], order. Seeded from `roadmap.json`. |
| `lc_solves` | slug, accepted_at (from LeetCode), rating (`nailed`/`struggled`/`help`/null), rated_at, slot (`new`/`review`/`mystery`), note |
| `lc_problem_state` | slug, state (`new`/`learning`/`reviewing`/`retained`/`parked`), interval_days, due_on, lapses |
| `lc_topic_state` | topic, level (`locked`/`learning`/`practicing`/`solid`/`mastered`), focus_since |
| `lc_daily_sets` | date, items jsonb (slug, slot, order, done), mixed_day bool |
| `lc_tag_counts` | tag, solved, synced_at |
| `projects` | id, name, repo (owner/name), local_path, active |
| `commits` | project_id, sha, message, committed_at |
| `ideas` | project_id, text, size (`S`/`M`), status (`todo`/`today`/`done`/`dropped`), source (`me`/`claude`), position |
| `applications` | Sheet mirror: company, role, track, term, location, status, priority, applied_on, row_hash. The table is replaced on each sync. |
| `postings` | id (job-radar id), company, title, location, url, posted_at, tier, starred, status (`new`/`seen`/`dismissed`/`outreach`) |
| `outreach` | id, job_url, company, role, resume_path, status (`queued`/`drafted`/`sent`/`replied`/`closed`), sent_on, follow_up_on |
| `contacts` | outreach_id, name, title, linkedin_url, email_guess, email_confidence (`verified`/`pattern`/`guess`), why, draft_subject, draft_body |
| `launch_requests` | id, kind (`outreach`/`suggest_ideas`), payload jsonb, status (`queued`/`launched`/`failed`), created_at |
| `sync_status` | source, last_ok_at, last_error, consecutive_failures |
| `streaks` | A view computed from solves, commits and the applications' applied_on. |

## 5. Screens

Navigation is a bottom tab bar on the phone and a sidebar on desktop. The design is dark-first with one accent color. Easy/medium/hard use LeetCode's colors. Exact visual choices are made during the build with the design skills.

1. **Today** (home)
   - Day counter, plus three streak chips (LeetCode, project, apps).
   - Today's LeetCode set as an ordered list. Each row is a link to LeetCode. A row checks itself off when sync sees an accepted solve, then shows the one-tap rating.
   - Today's project idea with a Done toggle. A commit to that project also completes it.
   - "Follow-ups due" (count, tap to open) and "New postings" (count, ⭐ first). Each is hidden when its count is zero.
2. **LeetCode**
   - Roadmap map of the 18 topics, colored by level.
   - Review queue.
   - History, with a heatmap.
   - Settings for daily count and focus override.
3. **Projects**
   - One card per project: last commit, a 30-day commit strip and the idea list (add, reorder, done).
   - A **Suggest improvements** button on each card.
4. **Applications**
   - Funnel (applied → OA → interview → offer) with conversion %, next to the 582/54/13/5 reference.
   - Applications this week vs. target.
   - Board grouped by stage, plus a search box.
   - "Open sheet" link.
5. **Jobs**
   - Inbox of new postings with filter chips (⭐, internship / new grad, term, location).
   - Row actions: Open, Cold email and Dismiss.
6. **Outreach**
   - A paste box at the top.
   - One card per job: status, contacts, drafts with copy buttons, and Sent/Replied buttons.
   - Marking Sent sets `follow_up_on = sent_on + 5 days`.
7. **Settings**
   - Nudge times, counts and targets, projects, ntfy topic, resume folder path.
   - Sync status for each source.

## 6. LeetCode engine

**Sync (worker, every 30 min):**
- `recentAcSubmissionList(adamkuhn, 20)` → insert any new `lc_solves`. Duplicates are skipped by (slug, accepted_at).
- `matchedUser.tagProblemCounts` → `lc_tag_counts` (shown on the roadmap; used to seed topic levels once).
- **Sync on open:** the browser can't call LeetCode directly because of CORS. A Vercel serverless function `web/api/sync-leetcode` runs the same LeetCode sync on demand. It is called when the app opens and on pull-to-refresh, rate-limited to once a minute, and authed with Adam's Supabase session. Solves therefore check off within seconds, not 30 minutes.
- Solves of problems outside the bank are stored and counted for streaks but don't affect mastery.
- Bootstrap on first run: the current last 20 accepted problems that are in the bank enter as `reviewing`, due today.

**Rating (one tap, shown after sync detects a solve):**
- 🟢 **Nailed it**: no help, roughly on time (the problem's `target_minutes`, otherwise E15 / M25 / H40), and at most 1 wrong submission.
- 🟡 **Struggled**: no help, but slow or with 2 or more wrong submissions.
- 🔴 **Needed help**: used a hint, video, AI or the solution.

An unrated solve counts toward the streak. The scheduler treats it as 🟡.

**Problem scheduling:**
```
on rating(p, r):
  if r == help:      p.state=learning; p.lapses+=1; p.interval=1
  elif r == struggled: p.interval=max(1, round(p.interval*1.2)); p.state=max(p.state, reviewing)
  else:              p.interval = next(i for i in [3,7,21,60,120] if i > p.interval, 120)
                     p.state = retained if p.interval >= 60 else reviewing
  p.due_on = today + p.interval
  if p.lapses >= 3 and r != nailed: p.state=parked; p.due_on = today+14
```
- Retained problems leave the queue.
- One retained problem is pulled in as a spot check each week. Failing it sends the problem back to `learning`.

**Topic levels** (recomputed after each rating):
- **Locked**: a prerequisite is below Practicing. This is a soft lock; Adam can override it and set any topic as the focus.
- **Learning**: at least 1 attempt.
- **Practicing**: at least 3 easy solved without help (or every easy in the pool) and at least 2 medium solved without help.
- **Solid**: at least 6 distinct mediums 🟢, at least 3 of them 🟢 again at an interval of 7 days or more, and at least 4 of the last 5 medium attempts 🟢.
- **Mastered**: all of these:
  - the topic is Solid
  - at least 1 hard solved without help
  - at least 2 mystery-slot mediums 🟢
  - at least 75% of the topic's NeetCode 150 problems at an interval of 21 days or more
- **Decay** (checked daily):
  - Mastered → Solid if there are 2 or more lapses in 30 days, or if 45 days pass with no 🟢 in the topic and a forced spot check fails.
  - Solid → Practicing if fewer than 60% of the last 5 attempts were 🟢.

**Daily set** (generated at 04:00 ET by the worker; N = `daily_lc_count`):
```
focus = current focus if level < solid and days_on_focus < 10
        else first topic in roadmap order whose prereqs are all >= practicing and level < solid
due   = reviews due today, focus topic first, then most overdue
R     = min(len(due), floor(0.4*N))
M     = 1 if at least 2 topics are >= practicing else 0      # mystery slot
new   = N - R - M
ladder: learning -> E,E,M,M(,M) · practicing -> E,M,M,M(,M) · solid -> M,M,M,H
        (no Hard until about 30 lifetime mediums; topics with no easy use the highest-acRate mediums)
pick:  unseen, free, focus topic; nc150 > blind75/grind169 > nc250 > supplement; then acRate desc
mystery: unseen medium from an older topic at practicing or above; topic hidden until solved
order: reviews -> easy -> medium -> hard (mystery placed between the mediums)
every 7th day: mixed day = N mystery problems from earlier topics, about 60% due reviews
```
- Premium problems never appear. Their free neetcode.io link is kept for reference only.
- A per-problem notes field is optional. Writing an explanation is not required for mastery.

The engine is a pure function `build_daily_set(state, bank, roadmap, today) -> items`. It lives in `worker/lockin_worker/lc_engine.py` and has its own unit tests, run against fixtures.

## 7. Projects

- Tracked projects: 27B (`adamkuhn1/27b`), Showboat (`adamkuhn1/showboat`), and a third project added from Settings once it has a repo. That will be a LEGO-from-photo app with its own brainstorm later; it is out of scope here.
- The worker pulls commits from the GitHub REST API for each repo's default branch. A commit today marks the project streak and completes "today's idea".
- **Today's idea**: the top `todo` idea from the project with the oldest last commit, so projects rotate. Adam can swap to another idea with one tap.
- **Suggest improvements** creates a `launch_requests(kind=suggest_ideas)`. The launcher opens Terminal in the project's `local_path` and runs `claude` with this prompt:

  > Read this repo (code, README, open GitHub issues). Propose 5 small improvements that each take under an hour and are visible or resume-relevant: a feature, polish, a test, perf, or docs. For each, give one line plus why it matters. Then run `lockin save-ideas --project <id>` with the list as JSON.

  The ideas appear in the app with source `claude`. Adam keeps or drops them.

## 8. Outreach

1. Adam pastes a job URL (or taps **Cold email** on a posting). This creates an `outreach` row (`queued`) and a `launch_requests(kind=outreach)`.
2. **Resume match** happens in the launcher on the Mac. It normalizes the company name from the URL or the posting, then looks for folders under `resume_root` whose name starts with that company.
   - One match: use it.
   - Several matches: the launcher asks in Terminal before starting `claude`.
   - No match: use `Base_Resume/Adam_Kuhn_Resume.pdf` and say so in the prompt.
   - iCloud-evicted files are downloaded first with `brctl download` before the read; if that fails, it falls back to the base resume.
3. The launcher opens Terminal with `claude "<outreach prompt>"`. The prompt template lives in `launcher/prompts/outreach.md` and includes:
   - the job URL and the resume path
   - Adam's context: CMU in Michigan, May 2027 grad, open to winter/spring co-ops and willing to push graduation to December 2027
   - the task: read the posting; find 2–3 people (recruiter, hiring manager or team lead, an engineer on the team; prefer CMU or Michigan ties); give a likely email with a confidence label (`verified`, `pattern` or `guess`); write an email for each, under 120 words, with one specific hook, one line on Adam's most relevant project and one clear ask
   - the final step: `lockin save-outreach --id <id>` with the JSON
4. **Guardrails** stated in the prompt: never send anything, use public information only, and label guesses as guesses.
5. In the app, the Sent button sets a follow-up date 5 days later. Replied stops follow-ups.
6. On the phone, requests show "Queued for Mac" until the launcher picks them up. Each card also has a **Copy prompt** fallback.

**Launcher:** a LaunchAgent, `com.adamkuhn.lockin.launcher`. It polls `launch_requests` every 10 s through Supabase Realtime, falling back to polling. For each request it marks it `launched`, then opens Terminal through `osascript`. Failures are written back as `failed` with the error.

## 9. Jobs (moved in from job-radar)

- Copy `job_radar/` (fetchers for Greenhouse, Lever, Ashby and the Simplify README, plus filters, location, posted) and `config/*.yaml` into `worker/lockin_worker/jobs/`, along with their tests.
- Replace `notify.py` and the `seen.json` state with Supabase upserts into `postings`.
- First run: mark everything currently open as `seen` so the inbox doesn't flood.
- **Cutover:** after the new worker has run cleanly for 24 hours, disable the `radar.yml` workflow in `adamkuhn1/job-radar` with `gh workflow disable`, and add a README note that the code now lives in lock-in. This needs Adam's go-ahead at that step.

## 10. Applications (Sheet, read-only)

- A Google Cloud service account with the Sheets API read-only scope. Adam shares the sheet with the service account's email as **Viewer**. The key JSON is stored as a GitHub Actions secret.
- The worker reads the `Applications` tab: the header is row 5, data starts at row 6, and the table is `ApplicationsTable`. Rows are mapped by header name, not by column letter, so reordering columns doesn't break the sync.
- Each sync replaces the `applications` table. Rows with no company are ignored.
- Funnel stages come from the Status values (e.g. `Submitted*` → applied, `OA*` → OA, `Interview*`/`R1`/`Final*` → interview, `Offer*` → offer, `Rejected` → closed). The mapping is a table in code and is shown in Settings so Adam can see it.

## 11. Nudges (ntfy)

All nudges go to Adam's existing ntfy topic and run in the worker at the slot nearest `nudge_times`. Defaults are 10:00, 18:00 and 22:00 America/Detroit.

- **10:00 plan:** "Sliding Window · 6 problems (1 review) · 9 new postings (2⭐) · 1 follow-up". Tapping it opens the app.
- **18:00:** sent only if something is undone: "Still open: LeetCode 2/6 · project".
- **22:00:** sent only if a streak is at risk: "LeetCode streak (6 days) ends at midnight".
- **Health:** a source failing for 24 hours straight sends one low-priority push. Shorter outages are shown only in Settings.

The cron is `*/30` and GitHub can delay runs, so each nudge fires on the first run at or after its time, at most once a day (tracked in `sync_status`).

## 12. Errors and resilience

- Each source syncs independently inside try/except, and updates `sync_status` on success or failure.
- Every sync is incremental from that source's last success, so a missed cron run catches up on the next one.
- The UI shows "last synced" per source in Settings, and a quiet badge if any source is more than 2 hours stale.
- The launcher being offline only leaves requests queued; nothing is lost.

## 13. Testing

- `worker`: pytest, with job-radar's existing tests moved over. Also new tests for the LeetCode engine (scheduling, levels, daily-set composition, fixtures for edge topics with no easy problems), the Sheet header mapping and status→stage mapping, nudge decisions (which messages fire, given state and time), and LeetCode/GitHub parsing against recorded fixtures.
- `web`: Vitest for streak and funnel helpers, and a Playwright smoke test at 390px and 1280px in light and dark that signs in with a test session and walks each tab.
- `launcher`/`cli`: unit tests for resume matching and prompt rendering.
- CI on every push: lint, typecheck, and all of the above.

## 14. Setup Adam does (one-time, guided)

1. Confirm a free Supabase slot is available. I create the project.
2. Create a Google Cloud service account and share the sheet with it (about 5 minutes, step by step).
3. Add GitHub Actions secrets (Supabase service key, Google key, ntfy topic).
4. Install the PWA on the iPhone and the Mac, and sign in with a magic link.
5. Install the launcher with `make install-launcher` and grant Terminal automation permission once.

## 15. Out of scope (v1)

- Writing to the Google Sheet, Gmail drafts, auto-sending, and resume tailoring.
- The LEGO project itself.
- LeetCode full-history import (it needs a session cookie). Can be added later as an optional one-time import.
- Multiple users.
