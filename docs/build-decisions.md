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
