# Lock In v2: Scoreboard redesign, prep, calendar, share card

Date: 2026-10-14 · Status: approved by Adam (one build, not split into parts) · Builds on: `2026-10-14-lock-in-design.md` (v1, live at https://lock-in-xi-navy.vercel.app)

## 1. Purpose

v1 works but feels bare next to the grind-account research. v2 makes Lock In feel like a training app for the internship season, in a single build:

- The **Scoreboard redesign** with 5 tabs: Day N, an any-work streak, the heatmap, activity rings, and the season funnel against a benchmark.
- **LEGO** as a tracked project, and **Work on this** on project ideas.
- **Interview prep** under Grind: story bank, prep log, fundamentals checklist, company prep, and Mock with Claude.
- A **Recruiting calendar** tab.
- A **Share card** under Me.

Success:
- Opening the app shows Day N, the streak, the heatmap, the rings and the funnel at a glance in the new look.
- Every v1 feature is one or two taps away.
- Prep, the calendar and the share card each work end to end on the live app.
- **Work on this** and **Mock with Claude** open briefed Claude Code sessions on the Mac.

## 2. Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Visual direction | "Scoreboard" (condensed bold italic numbers, activity rings, black) plus a GitHub-style heatmap, recolored orange |
| Navigation | 5 bottom tabs: Today · Grind · Hunt · Calendar · Me |
| Day 1 | 2026-09-28 (first application in the Sheet), editable in Settings |
| Streak rule | A day counts if it has at least one of: a LeetCode solve, an application, an outreach email sent, a project commit, or a prep session |
| LEGO | Tracked project only, not built here. It has no repo yet, so `repo` becomes optional |
| Work on this / Mock with Claude | A live interactive Claude Code session on the Mac. Adam approves changes. Not autonomous |
| Build approach | Re-skin and restructure the existing React app. Keep the data layer and tests. No UI kit, no chart library |
| Today's LeetCode set | Moves from Today to the top of Grind › LeetCode. Today becomes stats only |
| Heatmap | GitHub-style: weeks as columns, Mon–Sun top to bottom, small squares, not tappable (they'd fail the 44px tap-target rule). On desktop, hovering a square shows that day's counts |

"Plan day" everywhere means v1's `planDay`: the America/Detroit (Eastern) calendar day, shifted so it starts at 4 AM.

## 3. Screens

### Today
Top to bottom:
1. Top line: `TUE 10/14 · 🔥 N DAY STREAK`. The streak chip is hidden when the streak is 0.
2. **DAY N** in large condensed italic, with N in orange. N = plan days since `settings.day_one`, counting `day_one` as Day 1. It is 0 if `day_one` is in the future.
3. **Heatmap**, one square per day from Day 1 through today:
   - Weeks are columns, Mon–Sun top to bottom, oldest on the left. The container scrolls horizontally and starts scrolled to the newest week.
   - Days before Day 1 or after today are blank.
   - There are 5 levels: 0 is empty and 1–4 run from dim to bright orange. Intensity = the number of distinct activity kinds that day (solve, application, outreach, commit, prep), capped at 4.
   - Below the grid: `N DAYS` on the left and a less→more legend on the right.
   - Each square has a hover title (desktop) with that day's counts. The grid as a whole has an accessible summary ("Activity: 15 of 17 days active").
4. **Three rings**:
   - LeetCode: today's set completed / its size, in orange.
   - Applications: applications this week (Mon–Sun) / `weekly_app_target`, in yellow.
   - Emails: outreach sent this week / `weekly_email_target`, in cyan.
   A ring can go past 100%: it shows the full ring plus the real number.
5. **Season funnel**: 4 tiles (Applications, Online assessments, Interviews, Offers). Each shows its count. Every tile after the first also shows its conversion rate from the previous stage, next to the benchmark from @lockin.02's season (582 → 54 → 13 → 5). The benchmarks display as 9%, 24% and 38%. A rate at or above the benchmark is orange. A zero denominator shows `—`.
6. Tapping a ring or tile navigates: LeetCode → Grind › LeetCode, Applications ring and funnel tiles → Hunt › Applications, Emails → Hunt › Outreach.

### Grind
A segmented control switches between **LeetCode** (`/grind/leetcode`) and **Prep** (`/grind/prep`).
- **LeetCode**: today's set (moved from v1 Today: rating, solved state, "Already counted") as the primary card, then v1's roadmap, reviews and history.
- **Prep**: see §6.

### Hunt
A segmented control switches between Jobs · Applications · Outreach (`/hunt/jobs`, `/hunt/apps`, `/hunt/outreach`), which are v1's three screens, restyled. The Jobs segment shows a badge with the number of new postings, and Outreach shows a badge with follow-ups due. These replace v1 Today's "Also today" links.

### Calendar
See §7.

### Me
1. **Share today's card** row link to `/me/share` (see §8).
2. **Today's idea** card (moved from v1 Today: swap, done checkbox, "Done by today's commit").
3. **Projects**: a card per active project (27B, Showboat, LEGO) showing the last commit (or "No repo linked"), the 30-day commit strip and its ideas. Each idea row is an `IdeaCard` with a **Work on this** button, which shows "Queued for Mac", then "In progress". **Suggest improvements** stays.
4. **Settings** row link to `/me/settings`: v1 settings plus **Day 1** (date), **Weekly email target** (1–100) and an editable repo and local path per project.

### Routes
- `/` → Today
- `/grind/leetcode`, `/grind/prep` (`/grind` → leetcode)
- `/hunt/jobs`, `/hunt/apps`, `/hunt/outreach` (`/hunt` → jobs)
- `/calendar`
- `/me`, `/me/share`, `/me/settings`

Old v1 routes redirect: `/leetcode`→`/grind/leetcode`, `/projects`→`/me`, `/apps`→`/hunt/apps`, `/jobs`→`/hunt/jobs`, `/outreach`→`/hunt/outreach`, `/settings`→`/me/settings`.

## 4. Data (one migration, `0003_v2.sql`)

**Changes to existing tables**
- `settings`: add `day_one date not null default '2026-09-28'` and `weekly_email_target int not null default 10 check (between 1 and 100)`.
- `projects.repo`: drop `not null`. The worker's commit sync skips projects with no repo.
- `ideas`: add `started_at timestamptz`. The status check gains `in_progress`.
- `launch_requests.kind` gains `work_on_idea` and `mock_interview`.

**New owner tables** (RLS owner policy like v1's)
- `stories(id uuid, owner, title text not null, tags text[] not null default '{}', situation text, task text, action text, result text, last_practiced_on date, created_at)`
  - `tags` ⊆ `leadership, conflict, failure, impact, teamwork`, enforced with a check.
  - `situation`, `task`, `action` and `result` all default to `''`.
- `prep_sessions(id uuid, owner, kind text check in ('oa','mock','study','story'), minutes int check 1–600 null, note text, company text, story_id uuid, happened_on date not null, created_at)`
- `prep_progress(owner, item_id text, status text check in ('learning','solid'), updated_at)`, with primary key `(owner, item_id)`. No row means not started.
- `company_prep(id uuid, owner, company text not null, notes text default '', links text default '', interview_on date, created_at)`, unique on `(owner, company)`.
- `events(id uuid, owner, title text not null, kind text check in ('app_open','deadline','oa','interview','other'), on_date date not null, at_time time, company text, url text, created_at)`

**New global table**
- `prep_items(id text pk, track text check in ('system_design','cs'), title text, ord int)`: read-only for authenticated users, like `problems`. Seeded with about 30 items.

**View `day_activity`** (`security_invoker = true`): one row per owner per plan day from `day_one` through the current plan day, with:
- `solves`, `applications`, `outreach_sent`, `commits`, `prep_sessions`
- `kinds` (how many of those are > 0), `intensity` (`least(kinds, 4)`) and `active`

Timestamps map to their plan day. `applied_on`, `sent_on` and `happened_on` are already dates. Part of this build exists for the share card and later reuse. The web computes the same thing from the lists it already loads (`lib/activity.ts`), so demo mode works too.

**Seed**
- LEGO project: `id 'lego'`, `repo null`, `local_path '~/Developer/lego'`. Insert it only if missing, so a later seed never overwrites the repo once Adam links it.
- The `prep_items` list.

## 5. Work on this

1. Tapping **Work on this** sets the idea to `in_progress` with `started_at = now`, then inserts `launch_requests(kind='work_on_idea', payload={idea_id, prev_status})`.
2. The launcher loads the idea and its project. If the project has no `local_path`, or the folder doesn't exist, the request fails with "Project folder not found" and the idea goes back to `prev_status` with `started_at` cleared. Any other launch failure reverts the idea the same way.
3. Otherwise the launcher renders `prompts/work_on_idea.md` with:
   - the project name and repo
   - the idea text and size
   - the first 60 lines of `README.md` (or "No README.")
   - a branch name `idea/<slug>`, where the slug is the first 40 characters of the idea, lowercase, non-alphanumerics → `-`
   It then opens Terminal in `local_path` through v1's `terminal.open_in_terminal` (prompt file, 0600 permissions).
4. The prompt has Claude read the codebase, propose a short plan, wait for Adam's OK, build on that branch, run the tests and commit. It must not push, deploy or touch other projects, and it warns against granting broad Bash permission.
5. **Completion**: on each worker run, for each project, `in_progress` ideas are taken oldest `started_at` first. Each is matched to the first unused synced commit with `committed_at > started_at`, and becomes `done` with `done_at` = that commit's time. Adam can also mark it done or drop it by hand. v1's "a commit completes today's idea" rule is unchanged.

## 6. Interview prep (Grind › Prep)

Top to bottom:
1. **Company prep** (primary when present): one card per company whose application reached `oa`, `interview` or `offer`, plus any existing `company_prep` row.
   - The card has notes, links and the interview date.
   - Saving creates or updates the `company_prep` row. An interview date also appears on the Calendar.
   - Cards with an interview in the next 14 days sort first, with a countdown.
   - With none, it shows "No OAs or interviews yet. Prep cards appear here when your Sheet moves an application to OA or interview."
2. **Log prep**: buttons OA · Mock · Study, plus optional minutes (Stepper, default 30) and a note. Saving inserts a `prep_session` dated today's plan day, and it counts for the streak immediately. Below that, a list of this week's sessions.
3. **Mock with Claude**: buttons Behavioral and Technical, with an optional company picked from the company prep list.
   - A tap inserts `launch_requests(kind='mock_interview', payload={mode, company})`.
   - The launcher renders `prompts/mock_interview.md` with:
     - the story bank (each story's title, tags and the four STAR fields)
     - the company's notes (if any)
     - the mode
   - It opens Terminal in `~/.lockin/mock` (0700 permissions).
   - The prompt runs a 30-minute mock: behavioral asks 4–5 questions using the stories; technical gives one LeetCode-medium-style problem, talked through out loud.
   - It then gives feedback, and logs the session with `lockin log-prep --kind mock --minutes N --note "<one line>"`. This new CLI command inserts a `prep_session`.
   - The button shows "Queued for Mac" / "Opened on Mac" like Suggest.
4. **Story bank**: a list of stories, each showing its title, tags and "practiced N days ago" (or "never").
   - Tapping a story expands it into an edit form: title, tags (chip toggles) and Situation/Task/Action/Result textareas, with Save and Delete. Delete asks for confirmation in the page.
   - **Practiced** sets `last_practiced_on` to today and inserts a `prep_session(kind='story', story_id)`.
   - Adding a story starts from an empty form.
   - A hint line lists tags with no story yet ("No story for: conflict, failure").
5. **Fundamentals**: two Disclosures, "System design (x/N solid)" and "CS fundamentals (x/N solid)". Each item cycles not started → learning → solid → not started when tapped. That upserts or deletes `prep_progress`.

## 7. Recruiting calendar (`/calendar`)

1. **This week** card (primary), with a focus line picked by rule from the next 7 days of events (own events plus company-prep interview dates):
   - an interview within 7 days → "Interview in N days: mock + company notes" (links to Grind › Prep)
   - otherwise an OA → "OA in N days: daily OA practice"
   - otherwise a deadline → "Deadline in N days: <title>"
   - otherwise "Volume week: hit {weekly_app_target} applications"
   Below the line: apps this week vs target, and this week's event count.
2. **Month grid**: the current month, 7 columns Mon–Sun, with prev/next month buttons.
   - Days with events show a dot, colored by the earliest kind that day (interview orange, OA yellow, deadline cyan, other grey).
   - Tapping a day filters the list below to that day. Tapping it again clears the filter.
   - Today is outlined.
3. **Upcoming**: events from today on, grouped by week ("This week", "Next week", "Week of Nov 2"). Each row shows date, kind tag, title, company and a countdown chip ("today", "tomorrow", "in N days").
   - Sources: `events`, `company_prep.interview_on` (as interviews, titled "<Company> interview"), and outreach `follow_up_on` for sent outreach (as `other`, titled "Follow up: <Company>").
   - Own events can be deleted from their row.
4. **Add event**: a form with title, kind, date, optional time, company and URL.

**Nudge**: the 10:00 "Today's plan" body appends today's and tomorrow's items from the same three sources, e.g. "Stripe OA today · Figma interview tomorrow", up to 3 items.

## 8. Share card (`/me/share`)

- **Preview**: the card is drawn in the browser on a 1080×1920 `<canvas>` (`lib/shareCard.ts`) and shown scaled to fit, in the Scoreboard style:
  - date line, "DAY N", "🔥 N DAY STREAK"
  - the heatmap (last 18 weeks)
  - three stat blocks: LeetCode today x/y, applications this week, emails this week
  - funnel totals (4 numbers)
  - footer "lock-in" wordmark
  The fonts are loaded (`document.fonts.load`) before drawing.
- **Toggle**: "Show funnel" (default on).
- **Share**: the canvas is converted to a PNG. If `navigator.canShare({files})`, it calls `navigator.share`; otherwise it downloads `lock-in-day-N.png`.
- **Copy caption**: copies `Day N of locking in for SWE internships 🔒 | 🔥 S day streak | {x} LeetCode · {apps} apps this week #cs #swe #internship`.

## 9. Visual system

- **Dark only**: drop the light theme and the light Playwright projects. `color-scheme: dark`. The theme color and manifest colors are `#000`.
- **Tokens**: the existing token names are kept with new values, so the v1 component CSS restyles without being rewritten:
  - `--bg #000`, `--surface #141414`, `--surface-2 #1f1f1f`, `--border #262626`
  - `--text #fff`, `--muted #a3a3a3`
  - `--accent #ff4d1a`, `--accent-ink #000`
  New tokens:
  - Ring colors: `--orange #ff4d1a`, `--yellow #ffd21a`, `--cyan #1ad1ff`
  - Heatmap ramp: `--heat-0 #1a1a1a`, `--heat-1 #4a1f10`, `--heat-2 #7a2c12`, `--heat-3 #c23f15`, `--heat-4 #ff4d1a`
  - Fonts: `--display` (Barlow Condensed) and `--font` (Inter)
  All text meets WCAG AA contrast.
- **Type**: Barlow Condensed (500/700/800 and 800 italic) for h1, numbers and labels. Inter (400/500/600) for body text. Both are self-hosted through `@fontsource` packages and bundled, and the PWA precache includes `woff2`.
- **Components** (`web/src/ui/`, each with tests): `Ring`, `Heatmap`, `StatTile`, `FunnelTile`, `Segmented`, `IdeaCard`, plus the existing primitives restyled.
- **Motion**: on Today's first render, rings animate in (600ms) and DAY N counts up. Both are skipped under `prefers-reduced-motion` or where `matchMedia` is unavailable.
- **Layout**: phone first at 390px. At ≥900px the tab bar becomes the left sidebar (v1's pattern) and Today uses two columns.

## 10. Errors and empty states

- No activity yet: an empty heatmap and streak 0. `day_one` in the future: `DAY 0`.
- No Sheet data: the funnel shows `0` and the rates show `—`.
- Mac offline: launch buttons stay "Queued for Mac". A failed launch shows v1's short error with details.
- Load and save failures use v1's short-message pattern. No raw backend errors.
- If the share sheet is unavailable, the share card falls back to a download. If the canvas fails, it shows "Couldn't make the image."

## 11. Testing

- All of v1's tests (worker 443, web 181, e2e 48) still pass. Tests asserting the old structure or light theme are updated, not deleted.
- **Web unit tests**:
  - Day N, the streak, heatmap columns and intensity, including the 4 AM and DST boundaries
  - funnel rates
  - week focus rules, calendar merging and grouping, the month grid
  - the caption text and share-card stats
  - each component
  - route redirects
- **Worker tests**:
  - commit sync skips a null repo
  - in-progress ideas complete only on later commits
  - LEGO seed is insert-only
  - the streak-at-risk nudge uses the any-work rule
  - the plan nudge includes events
  - `log-prep` CLI
- **Launcher tests**: `work_on_idea` (missing folder → revert, README/no README, branch slug, revert on opener failure) and `mock_interview` (story rendering, directory permissions).
- **Migration**: text tests like v1's `test_schema.py`. After applying to the live DB, a check query compares `day_activity`'s row count to Day N.
- **e2e** (demo data): every tab and segment at 390px and 1280px (dark), with axe, tap targets and no horizontal scroll. Flows:
  - Today rings and funnel against fixture numbers
  - Work on this queues a request
  - log a prep session → the streak counts today
  - add an event → it appears in Upcoming
  - the share card renders a canvas

## 12. Out of scope

- Building the LEGO app.
- Autonomous Claude runs, pushes or PRs.
- A light theme.
- Custom SMTP for the iPhone sign-in code.
- Calendar sync with Google/iCal.
- Auto-posting to TikTok.
