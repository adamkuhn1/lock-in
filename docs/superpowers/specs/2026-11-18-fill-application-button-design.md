# Fill out application button (Outreach card)

## Intent
Adam wants to tailor a resume, review it, and only then have Claude fill in the application. Today the only autofill path is **Tailor & fill out app** on the Jobs screen, which tailors and fills in one session, so the form gets filled before he has looked at the resume.

## Goals
- A **Fill out application** button on the Outreach card that starts a fill-only Claude in Chrome session using that card's tailored PDF.
- Claude fills the whole form, never submits, and leaves the tab open on the last page for Adam to review and click Submit.

## Non-goals
- No auto-submit. No change to how "applied" is recorded (Adam still marks it himself).
- No change to the combined **Tailor & fill out app** button; it stays.

## Anti-goals
- Filling with the base resume, or with a stale PDF from another card.
- Any path where Claude clicks a submitting button, signs attestations, or enters passwords.

## Approaches
1. **New launch kind from the Outreach card (picked).** Reuses the launch queue, the Chrome-enabled session the combined button already gets, and the existing fill rules. Clean session, button lives in Lock In.
2. A "now fill it" step inside the tailor chat. Rejected: the button would live in the chat, not Lock In, and the long tailoring context crowds the form work.
3. Re-run the combined button. Rejected: it re-tailors.

## Design
- **Web (Outreach card):** show **Fill out application** when the card has a `resume_path` outside `Base_Resume/`, a safe `job_url`, and its latest request isn't queued. Click → `launch` with kind `fill_application`, payload `{ outreach_id, job_url }`. Demo mode mirrors it.
- **Worker:** new `build_fill(db, payload, lockin)` in `launcher.py`. Loads the outreach row, refuses (LaunchError) if `resume_path` is missing, is the base resume, or the file isn't on disk (ensure it's local from iCloud first). Work dir: the tailor work dir is not needed; use a fresh dir under `~/.lockin/tailor/` named after the card. Returns `(work, text, {"chrome": True})`. Register the kind wherever launch kinds are dispatched.
- **Prompt:** split `prompts/fill_application.md` so its rules render in two contexts: inside the tailor prompt (as today, Part 1b) and standalone (`prompts/fill_only.md`: who Adam is, the job, the PDF path, the same rules, ends with the summary instead of "go on to Part 2"). Same never-submit, decline-demographics, leave-attestations, sign-in-wall rules. Application answers come from `settings.profile.application` (already saved).
- **Tests:** launcher (builds prompt with the PDF path, refuses base/missing resume, chrome flag), prompts (standalone has no Part 2 references and keeps the never-submit rule), web Outreach card (button visibility and the queued payload), demo.

## Left to the builder
Exact file/function names, how the shared fill rules are factored (include vs. two templates), button styling consistent with Retailor resume.
