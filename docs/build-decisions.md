# Build decisions (2026-10-14)

These are decisions made during the autonomous build, where the plan was silent, wrong, or contradicted the spec. Each one notes the risk if it turns out to be wrong.

## Backend and worker
- **The schedule runs from Supabase `pg_cron` + `pg_net`, which triggers the GitHub sync workflow every 30 minutes.** GitHub's own schedule stays as a backup. On this account, job-radar's 30-minute GitHub cron actually ran only 4–6 times a day. *If wrong:* one extra setup step (a fine-grained PAT stored in Vault).
- **The plan day uses instant (UTC) arithmetic everywhere**, in both the worker and the web. A shared `shared/plan-day-cases.json` pins the daylight-saving edge cases. *If wrong:* a 1-hour window on two nights a year.
- **All solves of one problem within one plan day count as a single attempt.** The rating used is the earliest solve's rating, otherwise the first rating given. An unrated solve from an earlier day counts as 🟡. *If wrong:* rare double-solve edge cases score differently.
- **Mastered decay also blocks re-promotion.** After 2 or more "needed help" in 30 days, or no "nailed it" in 45 days, a topic can't become Mastered again until that clears. *If wrong:* Mastered is a little harder to win back.
- **Daily sets are protected against running out of problems.** A Hard is never served before 30 lifetime mediums. Short days are topped up from other unlocked topics. Focus rotates to the *next* topic after 10 days, or sooner if the current topic is out of problems.
- **New postings are insert-only** (ignore duplicates), so a dismissed or contacted posting is never reset to "new". Every database read is paginated. Posting URLs are cleaned so only http(s) links are kept.
- **Nudges are sent once per kind per day.** After an outage, only the latest pending nudge is sent. Health alerts never include error text, because ntfy topics are readable by anyone who knows the name. The 10 PM warning only fires if you have no solve on that calendar day.
- **A failing source never stops the others.** If Supabase itself is down, the run fails loudly. Logs show counts only, and URL query strings are redacted.
- **Seeding never blanks your settings.** Re-running the seed without the ntfy topic or Sheet ID keeps the stored values.
- **Sheet stage mapping:** "Not applied / to apply / planned" maps to `other`. "Offer declined" still counts as an offer, because one was received.

## Mac launcher and CLI
- **The launcher and CLI use the service-role key plus your owner ID, stored in the Keychain,** not a user refresh token, to avoid token-rotation bugs. *If wrong:* a key with full database access lives on your Mac. It is only readable as your user.
- **The Keychain helper lets `security` prompt for each value itself,** so secrets never appear in the process list.
- **When several resume folders match a company, the one whose name best matches the job title wins,** then the most recently edited. No question is asked in Terminal. *If wrong:* an occasional wrong resume, but the other matches are listed in the prompt.
- **If macOS blocks Desktop access, the launcher uses the base resume immediately,** without waiting on iCloud. It waits up to 15 seconds for iCloud downloads.
- **Outreach sessions run in `~/.lockin/outreach`,** not your home folder. Prompt files are private (0600 permissions).
- **Re-saving outreach inserts the new contacts first, then deletes the old ones,** so a failed save never loses drafts.
- **The launcher polls every 10 seconds** (no Realtime connection).

## Web app
- **Late ratings are blocked in the database, not just the UI.** Once the worker has counted a solve, rating it shows "Already counted."
- **Failed syncs and failed ratings show a short message.** No raw backend error text is ever shown to you.
- **Built-in topic levels show a visible word,** not color alone, for accessibility. Changing your focus topic has an Undo.
- **The Daily problem count is set only on the LeetCode screen.** "Opened on Mac" shows for 1 hour after a launch.
- **There's no Content Security Policy yet.** The security headers are conservative. Adding a CSP is a cheap follow-up.

## Deferred (later)
- A CSP header.
- The launch-request list is capped at 50.
- `load_attempts` dates each attempt by calendar day; consider switching to the plan day.
- No log rotation for the launcher.
- No commit pagination beyond 100 commits in 30 days.
- The iPhone status bar stays black-translucent in light mode, because iOS offers no per-theme setting.
- job-radar's own alerts are still on until you OK the cutover (setup step 8).

## v2 (2026-10-14)
- build on `build/v2`, FF main in Task 18 — live sync runs from main; pushing half-built worker code would break prod — cost if wrong: one extra FF step |
- "Also today" nav removed from Today in T10 (not just T11) — spec §3 Hunt says Hunt badges replace it (Task 16) — cost if wrong: links missing between T10 and T16 on the unshipped branch only
- in-flight id released in hook-level onSettled after refetch + setTimeout(0), not mutationFn finally as controller asked — finally-release let a stale button double-launch (brief test) — cost if wrong: id held for one refetch duration
- minutes is a number input, not v1 Stepper as spec §6 says — Stepper steps by 1 (30 taps to reach 60) — cost if wrong: cosmetic
- e2e nav test matches Me via anchored regex and reaches Settings via /me — demo sync is deliberately stale and Settings now lives under Me — cost if wrong: none (still exact-anchored)
- worker streak bounded by day_one (match web) — Day N/streak are "since Day 1" by spec — cost if wrong: nudge streak undercounts pre-Day-1 activity
- Task 18 order changed to: migrate (no LEGO) → restart launcher → push/FF main → LEGO insert → worker run → Vercel deploy — avoids v1 launcher stranding work_on_idea and v1 worker hitting repos/None — cost if wrong: none
- residual I1+I2 are load-bearing one-liners on shipped user paths (undo on Today; iPhone/Safari download) — apply as a tiny residual patch with its own focused tests + one scoped check, rather than shipping known bugs — cost if wrong: one extra small commit
- Deferred: FKs on prep_progress/prep_sessions; one commit can complete both a 'today' idea and a separately started idea on the same project; v1 per-kind streaks still use calendar day; Today hides non-settings query failures (shows zeros); heatmap per-day details are hover-only; `useWorkOnIdea` exposes an unguarded `mutateAsync` (unused).

## v3 (2026-10-28): engineer outreach, tiers, radar filtering
- **Reach = the old tier A, minus trading firms.** Old B and C became volume. Midwest is both a company tier (Midwest-headquartered employers) and a location rule: any non-reach posting in IL, MI, OH, IN, WI, MN, IA or MO is midwest, so a Capital One role in Chicago is midwest. A reach company stays reach anywhere. Companies the scanner doesn't watch are volume. *If wrong:* edit `tier:` in companies.yaml; the next scan re-tiers the open inbox.
- **Sort order is reach, midwest, volume.** *If wrong:* `TIERS` in web/src/lib/tiers.ts.
- **Applications get their tier from the Sheet sync** (company name plus Location), matched by a normalized company name and optional `aliases:` in companies.yaml. Applications to dropped trading firms are kept and read as volume (or midwest), so they're never flagged as Reach without a contact.
- **Engineers live in their own table (`referrals`), one row per person,** each with its own status, rather than as contacts on an outreach card, because each person moves through drafted → sent → accepted → replied → referred separately. Recruiter email cards are unchanged.
- **"Reach without a contact" means no engineer at that company has been sent a note.** A drafted note shows as "Note drafted, send it". Rejected and offer-stage applications aren't flagged. It matches by company, not role, since one engineer can refer for any role there. Recruiter emails don't count.
- **Find engineers runs on the Mac like the other Claude sessions,** with web search only. The prompt forbids opening, fetching or automating linkedin.com; profile URLs come from search results. It runs a short fit check first when there's a posting link. `lockin save-engineers` enforces 1–2 people, a linkedin.com/in URL and a note under 280 characters, and skips anyone already saved for that company.
- **The follow-up is due 3 days after acceptance; day 4 is still "today",** and it's overdue after that. It also counts in the morning nudge's follow-ups.
- **A LinkedIn note sent counts as outreach activity** for the streak and heatmap, in the SQL view, the worker and the web.
- **The weekly target (10) is its own setting** and its own ring on Today, between Apps and Emails.
- **Reply rates: a note counts as replied at replied or referred; an email at Replied.** Recruiter replies now store `replied_on`; older replied cards still count.
- **Non-SWE roles are dropped by title** (product, program, analyst unless technology or engineering, support, sales, hardware disciplines, trading, research scientist, actuarial, and others). Data scientist and ML stay, because the lists' Data Science sections were chosen on purpose. Data analyst and business analyst are dropped.
- **Wrong grad year:** a title naming 2023–2026 (or a 2028 grad class) without 2027 is dropped. In the full posting, a graduation window that covers neither May 2027 nor Dec 2027 is filtered. Fall 2027 co-ops stay because Dec 2027 is an option.
- **Full-posting checks run only where the board has a public description API** (Greenhouse, Lever, Ashby, and list rows that link to them): up to 60 new postings per run, plus 25 older inbox postings until all have been read. Workday and big-tech sites are judged on title only. Each check is conservative: a "preferred" or internship-counts requirement never filters.
- **Filtered postings are saved as `status = 'filtered'` with a reason,** not dropped, so mistakes are visible and can be restored. Title rejections of new postings stay silent, as before (there are thousands).
- **Dedupe across sources:** same link without tracking parameters, or same normalized company + title words with overlapping cities. It's checked against every saved posting, so a dismissed job doesn't come back from another list. *If wrong:* two different same-titled roles in one city merge into one card.
- **Trading firms are excluded by company name** (`companies.exclude` in filters.yaml), including on community lists. Point72/Cubist, D. E. Shaw, Renaissance, AQR, WorldQuant, PDT, Voleon, Balyasny and several Chicago prop shops are included as "similar". Millennium and Bridgewater are not. Banks, brokerages (Clear Street), prediction markets (Kalshi, Polymarket) and fintech stay.
- **Latency:** a jobs-only workflow every 10 minutes between the 30-minute full syncs, sharing their concurrency group. The repo is public, so Actions minutes are free. Each run logs `lag_min`, the median minutes from posting to discovery.
- **New sources:** 30 boards (20 Midwest, 10 volume), each live-verified with the repo's fetchers. Not added: iCIMS, SuccessFactors and Avature sites (Atlassian, AMD, DocuSign, Northwestern Mutual, DTE, Grainger, McDonald's, Epic), plus Rocket Companies, Walmart, Dell, Intuit and Goldman, which had no working public board.

## Learning tracks (2026-10-28)
- **The content lives in `shared/learning.json`,** and the worker upserts it into global read-only tables when the file's hash changes, like prep_items but without a manual seed. Items removed from the file are deleted; progress rows for them are left orphaned and ignored.
- **Every link was fetched live** (YouTube videos and playlists through oEmbed or the playlist page; three playlists have embedding turned off but are public). Substitutes: ByteByteGo's paid book became its free YouTube channel, The Mom Test book became Rob Fitzpatrick's free talk plus YC's "How To Talk To Users", nand2tetris lectures come from a public YouTube re-upload (Coursera's free audit isn't clear), MIT 6.824 is now 6.5840, and linear programming uses Cornell's free playlist. Stat 110's practice-problems page blocks automated requests (403), so it's confirmed only by a search result.
- **Module titles are at most 21 characters** (the app caps button labels at 24, including "N. "). The full wording stays in each summary.
- **A module is done only when Adam marks it done,** even with every item finished, because a Build item can reasonably stay open. Status shows not started, in progress or done, or "review due" once a done module's review date passes.
- **Spaced reviews:** 3, 7, 21, 60, then 120 days from the done date. Nailed moves one step out, struggled repeats the interval, needed help starts over.
- **Check me scoring:** 5 multiple choice plus 1 explain-it-back, out of 6. 5-6 is nailed, 3-4 struggled, 0-2 needed help (`lockin save-check` derives the rating if Claude leaves it out). It also marks the module's Check items done with that rating. Reviews are 3 questions: 3 nailed, 2 struggled, 0-1 help.
- **Teach me** runs in `~/.lockin/learn/<item>` (a scratch folder for exercises). Build items open in the project's folder when a project with that name and a local folder exists. Claude saves status, rating and a dated note with `lockin save-item`, only after asking Adam.
- **What's next** picks one step a day: a due review first; then the item in progress started most recently; then the next item in the furthest-along module; then the first module not started, rotating tracks by day. An item longer than today's learning time shows "X of it today". While LeetCode is unfinished, the learning button is secondary and LeetCode says "do this first".
- **Time split:** study minutes per day (default 180) and a learning percentage (default 30), in Settings. Only planned time is shown; actual time isn't tracked.
- **Finishing an item or taking a check counts as prep activity** for the streak and heatmap (SQL view, worker and web).
