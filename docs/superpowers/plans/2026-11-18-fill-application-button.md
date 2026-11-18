# Fill out application button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Fill out application** button on the Outreach card that starts a fill-only Claude in Chrome session with that card's tailored PDF, which fills the form, never submits, and leaves the tab open.

**Architecture:** A new launch kind `fill_application`. The web card queues it; the Mac worker's `BUILDERS` gets `build_fill`, which renders a standalone prompt and opens Claude with `chrome=True` (the opener already supports it). The fill rules in `prompts/fill_application.md` become shared by the tailor prompt (Part 1b, as today) and the new `prompts/fill_only.md`.

**Tech Stack:** Python worker (pytest, `MemoryDB`), React + Vite + TanStack Query web (vitest, Testing Library, demo API), Supabase Postgres migrations.

**Spec:** `docs/superpowers/specs/2026-11-18-fill-application-button-design.md`

## Global Constraints
- Claude never clicks Submit; the never-submit, decline-demographics, leave-attestations, sign-in-wall and untrusted-content rules stay word-for-word in both contexts.
- Only a tailored PDF: never `Base_Resume/`, never a missing file.
- Don't touch `prompts/tailor_resume.md` (Adam has uncommitted edits to it on main). Keep `launcher.py` edits to new functions plus the `BUILDERS` line.
- The combined **Tailor & fill out app** flow keeps working unchanged.
- Run worker tests from `worker/` with `~/.lockin/venv/bin/python -m pytest`; web tests from `web/` with `npx vitest run`.

## Review Focus
1. Card whose `resume_path` points into `Base_Resume/` (Cold email cards set this) → no button; worker refuses if requested anyway. Tests: Task 2 `test_fill_refuses_base_resume`, Task 3 "no button on a Cold email card".
2. A queued/launched fill request must not hijack the card's phase, **Try again**, or **Retailor resume** (they read `latestRequest`, filtered by `OUTREACH_KINDS`). Keep `fill_application` out of `OUTREACH_KINDS`. Test: Task 3 "fill request leaves Retailor and phase alone".
3. PDF in iCloud (placeholder only) → download via `resume.ensure_local`, else the iCloud message. Test: Task 2 `test_fill_icloud_placeholder_gets_icloud_message`.
4. `resume_path` outside the resume root, or not a `.pdf` → refuse. Test: Task 2 `test_fill_refuses_path_outside_root`.
5. Double click → second fill not queued while one is queued. Test: Task 3 "button disabled while a fill is queued".

---

### Task 1: Shared fill rules + standalone prompt

**Files:**
- Modify: `prompts/fill_application.md`
- Create: `prompts/fill_only.md`
- Modify: `worker/lockin_worker/launcher.py` (`_apply_values` only: pass the new placeholder values)
- Test: `worker/tests/test_prompts.py`, `worker/tests/test_launcher.py` (existing fill tests must still pass)

**Interfaces:**
- Produces: `fill_application.md` placeholders = `{"heading", "job_url", "job_url_shell", "application_answers", "resume_source", "next_step"}`. `fill_only.md` placeholders = `{"who", "company", "role", "job_url", "resume_path", "fill_rules"}`.
- Constants in `launcher.py`: `FILL_IN_TAILOR = {"heading": "## Part 1b: fill in the application in Chrome (never submit)", "resume_source": "the tailored PDF you saved in step 5 (the absolute path inside the new folder, never the base resume)", "next_step": "go straight on to Part 2"}`.

- [ ] **Step 1: Update `test_fill_application_template`** to assert the new placeholder set above, `t.startswith("\n{{heading}}")`, and the same rule needles minus `"tailored PDF you saved in step 5"` and `"go straight on to Part 2"` (now values). Add `test_fill_only_template`: placeholders equal the `fill_only.md` set; contains `"{{fill_rules}}"`, `"## Who Adam is"`, `"{{resume_path}}"`; contains no `"Part 2"`.
- [ ] **Step 2: Run** `python -m pytest tests/test_prompts.py -v` → FAIL.
- [ ] **Step 3: Edit `fill_application.md`:** first line → `{{heading}}`; step 3's resume sentence → "upload {{resume_source}}"; the two "go on to Part 2" spots → "then {{next_step}}" / "Then {{next_step}}. Don't wait for him to submit." Write `fill_only.md`: one-paragraph intro (fill in Adam's application for {{role}} at {{company}}, {{job_url}}, with Claude in Chrome; never submit), `## Who Adam is\n{{who}}`, then `{{fill_rules}}`, then a closing line: don't edit the resume or any files, run no shell commands except the `open` fallback. In `_apply_values`, add `**FILL_IN_TAILOR` to the render values.
- [ ] **Step 4: Run** `python -m pytest tests/test_prompts.py tests/test_launcher.py -v` → PASS (including `test_tailor_with_fill_opens_claude_with_chrome_and_fill_steps`, unchanged).
- [ ] **Step 5: Commit** `refactor(prompts): share the fill rules between Tailor & fill and a fill-only prompt`

### Task 2: `fill_application` launch kind in the worker + migration

**Files:**
- Modify: `worker/lockin_worker/launcher.py` (new `build_fill`, `FILL_STANDALONE`, `BUILDERS` entry)
- Create: `supabase/migrations/0014_fill_application.sql`
- Modify: `docs/setup.md` (one bullet next to the Tailor resume one: apply 0014, `make restart-launcher`)
- Test: `worker/tests/test_launcher.py`

**Interfaces:**
- Consumes: Task 1 templates and `FILL_IN_TAILOR` keys.
- Produces: `build_fill(db, payload: dict, lockin: str, find=None) -> tuple[Path, str, dict]` returning `(work_dir, prompt, {"chrome": True})`; payload `{"outreach_id", "job_url"}`. `BUILDERS["fill_application"] = build_fill`.
- `FILL_STANDALONE = {"heading": "## Fill in the application in Chrome (never submit)", "resume_source": "the tailored PDF at {path} (never the base resume)", "next_step": "stop there: this session only fills in the form"}` (format `{path}` before rendering).

- [ ] **Step 1: Write tests** with a `fill_db(tmp_path, resume_rel="Stripe_SWE_New_Grad/Adam_Kuhn_Resume.pdf", create=True)` fixture (settings with `resume_root`, outreach `t-1` with `resume_path`, company Stripe, role "Software Engineer, New Grad (2027)", request `fr1` kind `fill_application`):
  - `test_fill_opens_chrome_with_the_tailored_pdf`: `poll_once` → `[("fr1", "launched")]`; `op.kwargs == [{"chrome": True}]`; prompt contains the absolute PDF path, `"Open https://boards.greenhouse.io/stripe/jobs/1 in a new Chrome tab"`, `"You never click the final Submit button"`, `"Decline to self-identify"`, the saved application answers; no `"Part 2"`, no `"{{"`.
  - `test_fill_refuses_base_resume` (`resume_rel="Base_Resume/Adam_Kuhn_Resume.pdf"`) → request `failed`, error contains `"tailored resume"`; opener not called.
  - `test_fill_refuses_missing_resume_path` (no `resume_path`) and `test_fill_refuses_missing_file` (`create=False`) → `failed`, error mentions `"Tailor resume"` / the path.
  - `test_fill_refuses_path_outside_root` (`resume_path="/tmp/x.pdf"`) and non-`.pdf` → `failed`.
  - `test_fill_icloud_placeholder_gets_icloud_message` (only `.Adam_Kuhn_Resume.pdf.icloud` exists; reuse the `icloud` fixture) → error equals `ICLOUD_MSG`.
  - `test_fill_rejects_unsafe_job_url` (parametrize like `test_tailor_resume_rejects_unsafe_job_url`).
- [ ] **Step 2: Run** `python -m pytest tests/test_launcher.py -k fill_ -v` → new tests FAIL.
- [ ] **Step 3: Implement `build_fill`.** Load the outreach (LaunchError `outreach {oid!r} not found`), `_job_context` + `safe_job_url`, resolve root like `build_tailor`. Path checks, in order: no `resume_path` → `"No tailored resume on this card yet: run Tailor resume first"`; resolved path not under root, or suffix not `.pdf`, or under `root / BASE_RESUME` → `"Fill out application needs a tailored resume, not {path}"`; `resume.ensure_local(path, ICLOUD_RUN, ICLOUD_SLEEP)` then the same not-a-file / `.icloud` placeholder handling as the base-resume loop. Work dir `TAILOR_DIR / f"fill-{slugify(hint)}-{slugify(str(oid))[:8]}"` with 0700 like tailor. Render `fill_application` with `FILL_STANDALONE` (+ job_url, job_url_shell, answers from `profile.merged(...)["application"] or NO_ANSWERS`), then `fill_only` with `who` from `profile.prompt_values`. Add to `BUILDERS`.
- [ ] **Step 4: Migration** `0014_fill_application.sql`: drop/re-add `launch_requests_kind_check` with the 0012 list plus `'fill_application'`. Add the setup.md bullet.
- [ ] **Step 5: Run** `python -m pytest -q` (whole worker suite) → PASS.
- [ ] **Step 6: Commit** `feat(worker): fill_application launch kind opens Claude in Chrome with the tailored PDF`

### Task 3: Fill out application button on the Outreach card

**Files:**
- Modify: `web/src/data/types.ts` (`LaunchKind` += `'fill_application'`)
- Modify: `web/src/lib/outreach.ts` (new `latestFill`, `canFill`)
- Modify: `web/src/screens/Outreach.tsx` (`OutreachCard` props `onFill?`, `fillNote?`; wiring in `card`)
- Test: `web/src/lib/outreach.test.ts`, `web/src/screens/Outreach.test.tsx`

**Interfaces:**
- Consumes: kind `fill_application`, payload `{ outreach_id, job_url }`.
- Produces: `latestFill(o: Outreach, reqs: LaunchRequest[]): LaunchRequest | null` (newest `fill_application` for the card). `canFill(o: Outreach): boolean` = `resume_path` set, not containing `/Base_Resume/`, ends `.pdf`, and `safeHref(o.job_url)`. `fillNote(r: LaunchRequest | null): string | null` → queued `"Fill queued for your Mac"`, launched `"Filling it in Chrome on your Mac. Review it there and submit when ready."`, failed → null (error shown via `ErrorDetail` under the button).

- [ ] **Step 1: Write tests.**
  - lib: `canFill` true for `/R/Stripe_SWE/Adam_Kuhn_Resume.pdf`, false for `/R/Base_Resume/Adam_Kuhn_Resume.pdf`, null, `.tex`, unsafe job_url. `latestFill` picks newest fill and ignores tailor requests. `latestRequest` still ignores fill requests.
  - screen: "Fill out application on a tailored card queues a fill" → click `Fill out application: Acme`, `requestLaunch` called with `('fill_application', { outreach_id, job_url: 'https://jobs.lever.co/acme/3' })`. "no button on a Cold email card" (base `resume_path`) and "no button before tailoring" (`resume_path` null). "button disabled while a fill is queued" + shows `Fill queued for your Mac`. "fill request leaves Retailor and phase alone": with a launched tailor request and a newer launched fill request, the badge still reads the tailor phase and `Retailor resume: Acme` is present. A failed fill shows its error.
  - Give demo cards a tailored `resume_path` by overriding `api.listOutreach` in the test, as existing tests override `listLaunchRequests`.
- [ ] **Step 2: Run** `npx vitest run src/lib/outreach.test.ts src/screens/Outreach.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Button: `<Button aria-label={`Fill out application: ${name}`}>` with lucide `ClipboardPen` (as on Jobs), placed after Retailor, shown when `onFill` is set, disabled when `busy` or the latest fill is queued. `card` passes `onFill` when `canFill(o)` and status isn't `closed`. Do not add the kind to `OUTREACH_KINDS`.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc -b` → PASS.
- [ ] **Step 5: Commit** `feat(web): Fill out application button on tailored Outreach cards`
