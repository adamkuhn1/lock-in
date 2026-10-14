# Lock In — Plan 3: Mac launcher, `lockin` CLI, job-radar cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless macOS LaunchAgent that picks up `launch_requests` queued by the web app and opens Terminal running `claude` with a rendered prompt (cold outreach for a job URL, or project improvement ideas), plus the `lockin` CLI that Claude Code calls to save its results back to Supabase, and the human-gated retirement of job-radar's per-posting alerts.

**Architecture:** Everything lives inside Plan 1's Python package `lockin_worker` (no separate `launcher/` or `cli/` packages): `prompts.py` renders the shared templates in repo-root `prompts/`, `creds.py` reads the service-role key and owner id from the macOS Keychain and builds Plan 1's `RestDB`, `cli.py` validates JSON from stdin and writes contacts/ideas, `resume.py` matches a resume folder, `terminal.py` builds a safely quoted `osascript` call, and `launcher.py` is the 10-second poll loop. Every side effect (`subprocess.run`, the DB, the opener, `sleep`) is injected so the tests never touch Keychain, Terminal, iCloud or the network. `make install-launcher` creates `~/.lockin/venv`, installs the worker package editable, writes the plist and bootstraps it.

**Tech Stack:** Python 3.12 (stdlib: argparse, json, plistlib, shlex, subprocess), Plan 1's `lockin_worker.db.RestDB`/`MemoryDB`, pytest, macOS `security`, `osascript`, `brctl`, `launchctl`, GNU make.

**Spec:** `docs/superpowers/specs/2026-10-14-lock-in-design.md` (read §3, §7, §8, §9 "Cutover", §12, §14 before starting). Plan 1 (`docs/superpowers/plans/2026-10-14-lock-in-plan-1-backend.md`) must be done through Task 2 (schema) and Task 11 (seed: settings + projects rows). This plan reuses Plan 1 Task 1's `db.py` unchanged.

**Ordering with Plan 2 (web):** Task 1 of THIS plan is the single owner of `prompts/outreach.md` and `prompts/suggest_ideas.md`. Plan 2 Task 10 (Outreach "Copy prompt") imports them with Vite `?raw` and must not create or edit them. Run this plan's Task 1 before Plan 2 Task 10. Task 1 touches only `prompts/`, `worker/lockin_worker/prompts.py` and its test, so it can run any time after Plan 1 Task 1.

## Global Constraints

- Python 3.12, code inside `worker/lockin_worker/`, tests in `worker/tests/`, run with `cd worker && .venv/bin/pytest`.
- Reuse `lockin_worker.db.RestDB(url, key, owner)` and `MemoryDB()` exactly as Plan 1 Task 1 defines them. Do not modify `db.py`.
- Credentials (controller ruling, replaces spec §3's refresh token): Keychain service `lockin`, accounts `supabase_url`, `service_key`, `owner_id`, read with `security find-generic-password -s lockin -a <account> -w`. Env overrides for dev/tests only: `LOCKIN_SUPABASE_URL`, `LOCKIN_SERVICE_KEY`, `LOCKIN_OWNER_ID`. Never print, log or echo a secret value.
- Launcher: LaunchAgent label `com.adamkuhn.lockin.launcher`, `KeepAlive` + `RunAtLoad`, stdout and stderr to `~/Library/Logs/lockin-launcher.log`. Polls `launch_requests` with `status = 'queued'` every **10 s**. Polling only, no Realtime (ruling).
- For every request: mark `launched` **first**, then act; on any error mark `failed` with the error text (max 500 chars). A request is never opened twice.
- Resume matching (spec §8 + ruling): several matching folders → newest by mtime, the others listed in the prompt; no interactive Terminal question. No match → `<resume_root>/Base_Resume/Adam_Kuhn_Resume.pdf` and say so. Run `brctl download <path>` best effort first; if the file is still missing, use the base resume.
- Prompt templates live at repo root `prompts/*.md` (overrides spec §8's `launcher/prompts/`). Placeholders are `{{name}}` (lowercase + underscore); rendering fails loudly if any placeholder has no value, and values are inserted once (never re-expanded).
- The prompt text never appears in a shell command line: it is written to a file and passed as `claude "$(cat <file>)"`.
- Never send email or messages for Adam. The prompts say so in plain words. The CLI only writes drafts.
- Adam's context (copy verbatim into the outreach prompt): Central Michigan University (CMU), Mount Pleasant, Michigan; graduates May 2027; seeking a winter/spring 2027 internship or co-op; willing to push graduation to December 2027 for the right role.
- Commits keep the repo-local git identity (`adamkuhn1 <184679495+adamkuhn1@users.noreply.github.com>`). Never run `git config`. Another agent may be committing on the same branch: `git add` only the files your task lists, never `git add -A`/`.`. End commit messages with the attribution trailer lines the harness provides.

## Review Focus

1. **Claude runs `lockin save-outreach` twice** (it fixed a validation error, or Adam asked for edits) → the second run replaces that outreach's contacts instead of duplicating them, and a `sent` outreach is not reset to `drafted`. Pinned by `test_save_outreach_rerun_replaces_contacts` and `test_save_outreach_keeps_sent_status` (Task 2).
2. **Prompt or path contains quotes, `$`, backticks, `&`, or newlines** (job URLs with `?a=1&b='x'`, project folders with spaces) → Terminal receives the exact prompt, and no shell expansion happens. Pinned by `test_shell_command_roundtrip_hostile_prompt` and `test_applescript_string_roundtrip` (Task 4).
3. **Terminal automation denied / osascript fails, or the launcher crashes after marking `launched`** → the request ends `failed` with a readable error, and it is never reopened on the next poll. Pinned by `test_opener_error_marks_failed` and `test_marked_launched_before_open` (Task 4).
4. **Resume folder unreadable** (macOS blocks the LaunchAgent from `~/Desktop`, or `resume_root` is wrong) → the launch still happens with the base resume and a note telling Claude to check the folder. Pinned by `test_unreadable_root_falls_back` (Task 3).
5. **Supabase or Keychain unavailable during a poll** (Wi-Fi off after wake, Keychain locked) → the loop logs one line and keeps polling; it doesn't exit and doesn't spin. Pinned by `test_run_forever_survives_errors` (Task 4).

---

## File Structure

```
lock-in/
├── Makefile                                  # install-launcher, uninstall-launcher, keychain, launcher-status (Task 5)
├── prompts/
│   ├── outreach.md                           # shared with Plan 2 (Task 1, owner)
│   └── suggest_ideas.md                      # shared with Plan 2 (Task 1, owner)
├── scripts/keychain.sh                       # read -s → security add-generic-password -U (Task 5)
├── docs/setup.md                             # + "Mac launcher" and "job-radar cutover" sections (Tasks 5, 6)
└── worker/
    ├── pyproject.toml                        # + console scripts lockin, lockin-launcher (Task 2)
    ├── lockin_worker/
    │   ├── prompts.py                        # load + render templates (Task 1)
    │   ├── creds.py                          # Keychain → RestDB (Task 2)
    │   ├── cli.py                            # lockin save-outreach | save-ideas | doctor (Task 2)
    │   ├── resume.py                         # company normalize, folder match, iCloud (Task 3)
    │   ├── terminal.py                       # prompt file, shell + AppleScript quoting (Task 4)
    │   ├── launcher.py                       # build prompts per kind, process, poll loop (Task 4)
    │   └── install.py                        # plist writer (Task 5)
    └── tests/
        ├── test_prompts.py  test_creds.py  test_cli.py
        ├── test_resume.py   test_terminal.py  test_launcher.py
        └── test_install.py
```

---

### Task 1: Shared prompt templates (owner of `prompts/`)

**Files:**
- Create: `prompts/outreach.md`, `prompts/suggest_ideas.md`, `worker/lockin_worker/prompts.py`, `worker/tests/test_prompts.py`

**Interfaces:**
- Produces:
  - `prompts.TemplateError(Exception)`
  - `prompts.PLACEHOLDER` (compiled regex `\{\{\s*([a-z_]+)\s*\}\}`)
  - `prompts.placeholders(template: str) -> set[str]`
  - `prompts.render(template: str, values: dict[str, str]) -> str`
  - `prompts.load(name: str) -> str` (reads `<prompts_dir>/<name>.md`)
  - `prompts.prompts_dir() -> Path` (`$LOCKIN_PROMPTS_DIR` or `<repo>/prompts`)
  - Template placeholders (Plan 2 Task 10 fills the same names):
    - `outreach.md`: `outreach_id, job_url, company, resume_path, resume_note, lockin`
    - `suggest_ideas.md`: `project_id, project_name, repo, lockin`

- [ ] **Step 1: Write the failing tests**

`worker/tests/test_prompts.py`:
```python
import pytest
from lockin_worker import prompts


def test_render_fills_values_once():
    out = prompts.render("Hi {{name}}, id={{ id }}", {"name": "{{id}}", "id": "7"})
    assert out == "Hi {{id}}, id=7"  # a value that looks like a placeholder is not re-expanded


def test_render_missing_value_raises():
    with pytest.raises(prompts.TemplateError, match="missing values for: b"):
        prompts.render("{{a}} {{b}}", {"a": "1"})


def test_render_ignores_extra_values():
    assert prompts.render("{{a}}", {"a": "1", "z": "2"}) == "1"


def test_outreach_template_placeholders():
    t = prompts.load("outreach")
    assert prompts.placeholders(t) == {"outreach_id", "job_url", "company", "resume_path", "resume_note", "lockin"}


def test_outreach_template_has_guardrails_and_context():
    t = prompts.load("outreach")
    for needle in ["Never send", "Public information only", "Central Michigan University (CMU)",
                   "May 2027", "December 2027", "under 120 words", "`verified`", "`pattern`", "`guess`",
                   "{{lockin}} save-outreach --id {{outreach_id}} <<'JSON'", "Saved N contacts"]:
        assert needle in t, needle


def test_suggest_template():
    t = prompts.load("suggest_ideas")
    assert prompts.placeholders(t) == {"project_id", "project_name", "repo", "lockin"}
    assert "{{lockin}} save-ideas --project {{project_id}} <<'JSON'" in t
    assert "exactly 5" in t and "under an hour" in t


def test_prompts_dir_env_override(tmp_path, monkeypatch):
    (tmp_path / "x.md").write_text("{{a}}")
    monkeypatch.setenv("LOCKIN_PROMPTS_DIR", str(tmp_path))
    assert prompts.load("x") == "{{a}}"
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd worker && .venv/bin/pytest tests/test_prompts.py -v`
Expected: FAIL with `ImportError: cannot import name 'prompts'`.

- [ ] **Step 3: Implement `prompts.py`**

`worker/lockin_worker/prompts.py`:
```python
from __future__ import annotations

import os
import re
from pathlib import Path

PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
REPO_ROOT = Path(__file__).resolve().parents[2]


class TemplateError(Exception):
    pass


def prompts_dir() -> Path:
    return Path(os.environ.get("LOCKIN_PROMPTS_DIR") or REPO_ROOT / "prompts")


def placeholders(template: str) -> set[str]:
    return set(PLACEHOLDER.findall(template))


def render(template: str, values: dict[str, str]) -> str:
    missing = placeholders(template) - values.keys()
    if missing:
        raise TemplateError(f"missing values for: {', '.join(sorted(missing))}")
    return PLACEHOLDER.sub(lambda m: str(values[m.group(1)]), template)


def load(name: str) -> str:
    return (prompts_dir() / f"{name}.md").read_text(encoding="utf-8")
```
`REPO_ROOT` works because the package is always installed editable (`pip install -e`), so `__file__` stays inside the repo.

- [ ] **Step 4: Write `prompts/outreach.md`** (exact content)

````markdown
You're helping Adam Kuhn with cold outreach for one job. You draft; Adam reviews and sends. Never send anything yourself.

## The job
- Posting: {{job_url}}
- Company (best guess, confirm it on the posting): {{company}}
- Resume to use: {{resume_path}}
- Resume note: {{resume_note}}

## Who Adam is
- CS student at Central Michigan University (CMU) in Mount Pleasant, Michigan. Graduates May 2027.
- Looking for a winter or spring 2027 internship or co-op. For the right role he will push graduation to December 2027, so terms through fall 2027 work too.
- CMU is a non-target school, so a short, specific note beats a polished generic one.

## Steps
1. Read the posting (fetch the URL). Note the team, product, location, term, stack, and anything specific to this role. If the page won't load, ask Adam to paste the description and wait.
2. Read the resume at the path above. Pick the single project most relevant to this role. Use only facts from the resume.
3. Find 2–3 real people at the company, using public web search:
   - a university or early-career recruiter (or the recruiter named on the posting)
   - the hiring manager or team lead for this team
   - an engineer on this team or the closest related team
   Prefer people with CMU or Michigan ties (alumni, worked or lived in Michigan) when they're otherwise a good fit. Skip anyone you can't tie to this company with a public source. Two strong contacts beat three weak ones.
4. For each person, give a likely work email and a confidence label:
   - `verified`: this exact address appears in a public source
   - `pattern`: built from the company's email pattern, and that pattern appears in a public source (name it)
   - `guess`: anything else. Label guesses as guesses.
5. Write one email per person:
   - under 120 words, plain text, no flattery, no buzzwords
   - one specific hook about them or their team, from a public source
   - one line on Adam's most relevant project, from the resume
   - one clear, small ask (a 15-minute chat, or whether they'd pass his resume to the hiring manager)
   - name the role, and say he's a CMU student graduating May 2027 (flexible through December 2027)
   - a subject line under 8 words
6. Save the results (next section), then show Adam a short summary: each person, their email and confidence, and the subject line. If he asks for changes, edit and save again. Saving again replaces the earlier drafts.

## Rules
- Never send email, LinkedIn messages, connection requests, or anything else. Never fill in forms or apply. Draft only.
- Public information only. No logins, no paid data brokers, no scraping behind sign-in walls.
- Don't invent people, titles, emails, or project details. When unsure, say so in `why`.

## Save
Run exactly this, with the quoted heredoc so the shell leaves the text alone:

    {{lockin}} save-outreach --id {{outreach_id}} <<'JSON'
    {
      "company": "Company name",
      "role": "Role title from the posting",
      "contacts": [
        {
          "name": "Full Name",
          "title": "Their title",
          "linkedin_url": "https://www.linkedin.com/in/...",
          "email_guess": "first.last@company.com",
          "email_confidence": "pattern",
          "why": "One line: why this person, and the source for the email.",
          "draft_subject": "Subject line",
          "draft_body": "The email body."
        }
      ]
    }
    JSON

`name`, `draft_subject` and `draft_body` are required. `email_confidence` is required when `email_guess` is set. If the command prints an error, fix the JSON and run it again. It worked when it prints `Saved N contacts`.
````

- [ ] **Step 5: Write `prompts/suggest_ideas.md`** (exact content)

````markdown
You're in the repo for {{project_name}} ({{repo}}), one of Adam Kuhn's portfolio projects. Adam is a CS student applying for 2027 internships, so the best improvements are ones a recruiter or interviewer would notice, or that make the code something he's proud to walk through.

## Steps
1. Read the README, the main source folders and the tests. Check the open issues with `gh issue list --state open --limit 30` (skip this if `gh` isn't signed in) and recent work with `git log --oneline -20`, so you don't suggest something just done.
2. Propose exactly 5 small improvements. Each one must:
   - take Adam under an hour (size `S`) or about an afternoon (size `M`); at least 3 must be `S`
   - be visible or resume-relevant: a user-facing feature, UI polish, a meaningful test, a performance win, or docs (README, screenshots, setup steps)
   - be concrete enough to start right away: name the file, screen or command
   - not repeat an open issue unless it's the best next step; then end the line with "(issue #N)"
3. Write each as one line under 100 characters: "<what to do> — <why it matters>".
4. Save them:

    {{lockin}} save-ideas --project {{project_id}} <<'JSON'
    [
      {"text": "Add a loading skeleton to the feed — first paint feels instant", "size": "S"}
    ]
    JSON

   It worked when it prints `Saved N ideas`. If it prints an error, fix the JSON and run it again.
5. List the 5 ideas for Adam. Don't start implementing any of them unless he asks.

## Rules
- Read only: don't edit files, create branches, commit, push, or open issues or PRs.
````

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd worker && .venv/bin/pytest tests/test_prompts.py -v`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add prompts/outreach.md prompts/suggest_ideas.md worker/lockin_worker/prompts.py worker/tests/test_prompts.py
git commit -m "Add shared Claude prompt templates for outreach and project ideas"
```

---

### Task 2: Keychain credentials and the `lockin` CLI

**Files:**
- Create: `worker/lockin_worker/creds.py`, `worker/lockin_worker/cli.py`, `worker/tests/test_creds.py`, `worker/tests/test_cli.py`
- Modify: `worker/pyproject.toml` (add `[project.scripts]`)

**Interfaces:**
- Consumes: `db.RestDB`, `db.MemoryDB`, `db.DBError` (Plan 1 Task 1)
- Produces:
  - `creds.SERVICE = "lockin"`, `creds.ACCOUNTS: dict[str, str]` (account → env override name)
  - `creds.CredsError(Exception)`
  - `creds.keychain_get(account: str, run=subprocess.run) -> str`
  - `creds.get(account: str, env: Mapping | None = None, run=subprocess.run) -> str`
  - `creds.make_db(env=None, run=subprocess.run) -> RestDB`
  - `cli.InputError(Exception)`
  - `cli.parse_json(text: str) -> Any`
  - `cli.validate_outreach(data) -> tuple[dict, list[str]]` (clean data, warnings)
  - `cli.validate_ideas(data) -> list[dict]`
  - `cli.save_outreach(db, outreach_id: str, data: dict) -> int`
  - `cli.save_ideas(db, project_id: str, ideas: list[dict]) -> tuple[int, int]` (saved, duplicates skipped)
  - `cli.main(argv=None, stdin=None, stdout=None, stderr=None, db_factory=creds.make_db) -> int` — exit 0 ok, 2 bad input, 1 credentials/DB error
  - console scripts `lockin` → `lockin_worker.cli:main_entry`, `lockin-launcher` → `lockin_worker.launcher:main` (launcher module arrives in Task 4; the script entry is harmless until then)

- [ ] **Step 1: Write failing credential tests**

`worker/tests/test_creds.py`:
```python
import subprocess
import pytest
from lockin_worker import creds


class Run:
    def __init__(self, values):
        self.values, self.calls = values, []

    def __call__(self, argv, **kw):
        self.calls.append(argv)
        acct = argv[argv.index("-a") + 1]
        v = self.values.get(acct)
        return subprocess.CompletedProcess(argv, 0 if v else 44, stdout=(v or "") + "\n", stderr="")


def test_keychain_argv_and_strip():
    run = Run({"service_key": "sk-123"})
    assert creds.keychain_get("service_key", run) == "sk-123"
    assert run.calls[0] == ["security", "find-generic-password", "-s", "lockin", "-a", "service_key", "-w"]


def test_env_override_skips_keychain():
    run = Run({})
    assert creds.get("owner_id", {"LOCKIN_OWNER_ID": "u-1"}, run) == "u-1"
    assert run.calls == []


def test_missing_item_error_is_helpful_and_secret_free():
    with pytest.raises(creds.CredsError, match="make keychain") as e:
        creds.get("service_key", {}, Run({}))
    assert "lockin/service_key" in str(e.value)


def test_make_db_uses_all_three():
    run = Run({"supabase_url": "https://p.supabase.co", "service_key": "k", "owner_id": "o"})
    db = creds.make_db({}, run)
    assert (db.base, db.key, db.owner) == ("https://p.supabase.co/rest/v1/", "k", "o")
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd worker && .venv/bin/pytest tests/test_creds.py -v`
Expected: FAIL with `ImportError: cannot import name 'creds'`.

- [ ] **Step 3: Implement `creds.py`**

`worker/lockin_worker/creds.py`:
```python
from __future__ import annotations

import os
import subprocess
from typing import Mapping

from .db import RestDB

SERVICE = "lockin"
ACCOUNTS = {
    "supabase_url": "LOCKIN_SUPABASE_URL",
    "service_key": "LOCKIN_SERVICE_KEY",
    "owner_id": "LOCKIN_OWNER_ID",
}


class CredsError(Exception):
    pass


def keychain_get(account: str, run=subprocess.run) -> str:
    r = run(["security", "find-generic-password", "-s", SERVICE, "-a", account, "-w"],
            capture_output=True, text=True)
    value = (r.stdout or "").strip()
    if r.returncode != 0 or not value:
        raise CredsError(f"Keychain item {SERVICE}/{account} not found. Run `make keychain` in the lock-in repo.")
    return value


def get(account: str, env: Mapping | None = None, run=subprocess.run) -> str:
    env = os.environ if env is None else env
    override = env.get(ACCOUNTS[account])
    return override if override else keychain_get(account, run)


def make_db(env: Mapping | None = None, run=subprocess.run) -> RestDB:
    return RestDB(get("supabase_url", env, run), get("service_key", env, run), get("owner_id", env, run))
```

- [ ] **Step 4: Run the credential tests and confirm they pass**

Run: `cd worker && .venv/bin/pytest tests/test_creds.py -v`
Expected: 4 passed.

- [ ] **Step 5: Write failing CLI tests**

`worker/tests/test_cli.py`:
```python
import io
import json
import pytest
from lockin_worker import cli
from lockin_worker.db import MemoryDB, DBError

OID = "11111111-1111-1111-1111-111111111111"

CONTACT = {"name": "Dana Reyes", "title": "University Recruiter", "linkedin_url": "https://www.linkedin.com/in/dana",
           "email_guess": "dana.reyes@stripe.com", "email_confidence": "pattern", "why": "Recruits interns; pattern from rocketreach blog",
           "draft_subject": "CMU junior, Winter 2027 SWE intern", "draft_body": "Hi Dana, short and specific."}


def db_with_outreach(status="queued", company=None):
    db = MemoryDB()
    db.insert("outreach", [{"id": OID, "job_url": "https://x/1", "status": status, "company": company, "role": None}])
    db.insert("projects", [{"id": "27b", "name": "27B", "repo": "adamkuhn1/27b", "active": True}])
    return db


def run(db, argv, stdin_text):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(argv, stdin=io.StringIO(stdin_text), stdout=out, stderr=err, db_factory=lambda: db)
    return code, out.getvalue(), err.getvalue()


def test_save_outreach_inserts_and_marks_drafted():
    db = db_with_outreach()
    code, out, _ = run(db, ["save-outreach", "--id", OID],
                       json.dumps({"company": "Stripe", "role": "SWE Intern", "contacts": [CONTACT, {**CONTACT, "name": "Sam Lee"}]}))
    assert code == 0 and out.strip() == "Saved 2 contacts"
    assert {c["name"] for c in db.select("contacts")} == {"Dana Reyes", "Sam Lee"}
    assert all(c["outreach_id"] == OID for c in db.select("contacts"))
    o = db.select("outreach")[0]
    assert (o["status"], o["company"], o["role"]) == ("drafted", "Stripe", "SWE Intern")


def test_save_outreach_rerun_replaces_contacts():
    db = db_with_outreach()
    body = json.dumps({"company": "Stripe", "role": "r", "contacts": [CONTACT]})
    run(db, ["save-outreach", "--id", OID], body)
    run(db, ["save-outreach", "--id", OID], body)
    assert len(db.select("contacts")) == 1


def test_save_outreach_keeps_sent_status_and_existing_company():
    db = db_with_outreach(status="sent", company="Stripe, Inc.")
    run(db, ["save-outreach", "--id", OID], json.dumps({"company": "Stripe", "contacts": [CONTACT]}))
    o = db.select("outreach")[0]
    assert (o["status"], o["company"]) == ("sent", "Stripe, Inc.")


def test_invalid_json_exit_2_with_location():
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID], '{"contacts": [}')
    assert code == 2 and "invalid JSON" in err and "line 1" in err


def test_validation_lists_every_problem():
    bad = {"contacts": [{"name": "", "email_guess": "nope", "draft_body": "x"},
                        {"name": "A", "email_guess": "a@b.co", "email_confidence": "sure", "draft_subject": "s", "draft_body": "b",
                         "linkedin_url": "linkedin.com/in/a"}]}
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID], json.dumps(bad))
    assert code == 2
    for msg in ["$.contacts[0].name: required", "$.contacts[0].draft_subject: required",
                "$.contacts[0].email_guess: not an email address",
                "$.contacts[0].email_confidence: required when email_guess is set",
                "$.contacts[1].email_confidence: must be one of verified, pattern, guess",
                "$.contacts[1].linkedin_url: must start with https://"]:
        assert msg in err, msg


def test_empty_contacts_and_wrong_shape():
    assert run(db_with_outreach(), ["save-outreach", "--id", OID], '{"contacts": []}')[0] == 2
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID], "[1,2]")
    assert code == 2 and "expected a JSON object" in err


def test_unknown_outreach_id():
    code, _, err = run(MemoryDB(), ["save-outreach", "--id", OID], json.dumps({"contacts": [CONTACT]}))
    assert code == 2 and f"no outreach request with id {OID}" in err


def test_empty_stdin_explains_heredoc():
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID], "  ")
    assert code == 2 and "<<'JSON'" in err


def test_long_body_warns_but_saves():
    long = {**CONTACT, "draft_body": " ".join(["word"] * 130)}
    code, out, err = run(db_with_outreach(), ["save-outreach", "--id", OID], json.dumps({"contacts": [long]}))
    assert code == 0 and "130 words (aim for under 120)" in err


def test_save_ideas_appends_with_positions_and_skips_duplicates():
    db = db_with_outreach()
    db.insert("ideas", [{"id": "i0", "project_id": "27b", "text": "Add README screenshots", "status": "todo", "position": 4}])
    ideas = [{"text": "Add README screenshots", "size": "S"}, {"text": "Cache API calls", "size": "M"}, {"text": "Add a test"}]
    code, out, _ = run(db, ["save-ideas", "--project", "27b"], json.dumps(ideas))
    assert code == 0 and out.strip() == "Saved 2 ideas (1 duplicate skipped)"
    new = sorted((i for i in db.select("ideas") if i["id"] != "i0"), key=lambda i: i["position"])
    assert [(i["text"], i["size"], i["position"], i["source"], i["status"]) for i in new] == [
        ("Cache API calls", "M", 5, "claude", "todo"), ("Add a test", "S", 6, "claude", "todo")]


def test_save_ideas_validation():
    code, _, err = run(db_with_outreach(), ["save-ideas", "--project", "27b"],
                       json.dumps([{"text": ""}, {"text": "x", "size": "L"}, "plain string"]))
    assert code == 2
    assert "$[0].text: required" in err and "$[1].size: must be S or M" in err and "$[2]: must be an object" in err


def test_save_ideas_unknown_project():
    code, _, err = run(db_with_outreach(), ["save-ideas", "--project", "nope"], json.dumps([{"text": "a"}]))
    assert code == 2 and "no project with id 'nope'" in err


def test_db_error_exit_1():
    class Down(MemoryDB):
        def select(self, *a, **k):
            raise DBError("GET outreach: HTTP 503")
    code, _, err = run(Down(), ["save-outreach", "--id", OID], json.dumps({"contacts": [CONTACT]}))
    assert code == 1 and "HTTP 503" in err


def test_doctor_reports_without_secrets():
    db = db_with_outreach()
    db.insert("settings", [{"resume_root": "~/Desktop/Adam_Kuhn_Resumes"}])
    db.insert("launch_requests", [{"id": "r1", "status": "queued", "kind": "outreach", "payload": {}}])
    code, out, _ = run(db, ["doctor"], "")
    assert code == 0 and "connected" in out and "1 queued launch request" in out
```

- [ ] **Step 6: Run them and confirm they fail**

Run: `cd worker && .venv/bin/pytest tests/test_cli.py -v`
Expected: FAIL with `ImportError: cannot import name 'cli'`.

- [ ] **Step 7: Implement `cli.py`**

`worker/lockin_worker/cli.py`:
```python
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from . import creds
from .db import DBError

CONFIDENCE = ("verified", "pattern", "guess")
SIZES = ("S", "M")
MAX_CONTACTS = 5
MAX_IDEAS = 10
WORD_TARGET = 120
HEREDOC_HINT = "Pipe the JSON in with a quoted heredoc, e.g.  lockin save-ideas --project 27b <<'JSON' ... JSON"


class InputError(Exception):
    pass


def parse_json(text: str) -> Any:
    if not text.strip():
        raise InputError(f"no JSON on stdin. {HEREDOC_HINT}")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise InputError(f"invalid JSON: {e.msg} at line {e.lineno} column {e.colno}") from None


def _str(obj: dict, key: str, path: str, errors: list[str], required=False, max_len: int | None = None) -> str | None:
    v = obj.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            errors.append(f"{path}.{key}: required")
        return None
    if not isinstance(v, str):
        errors.append(f"{path}.{key}: must be a string")
        return None
    v = v.strip()
    if max_len is not None and len(v) > max_len:
        errors.append(f"{path}.{key}: longer than {max_len} characters")
    return v


def validate_outreach(data: Any) -> tuple[dict, list[str]]:
    if not isinstance(data, dict):
        raise InputError("expected a JSON object with company, role and contacts")
    errors: list[str] = []
    warnings: list[str] = []
    company = _str(data, "company", "$", errors, max_len=200)
    role = _str(data, "role", "$", errors, max_len=200)
    contacts = data.get("contacts")
    if not isinstance(contacts, list) or not contacts:
        errors.append("$.contacts: must be a non-empty list")
        contacts = []
    elif len(contacts) > MAX_CONTACTS:
        errors.append(f"$.contacts: at most {MAX_CONTACTS} contacts")
    clean = []
    for i, c in enumerate(contacts[:MAX_CONTACTS]):
        p = f"$.contacts[{i}]"
        if not isinstance(c, dict):
            errors.append(f"{p}: must be an object")
            continue
        row = {
            "name": _str(c, "name", p, errors, required=True, max_len=200),
            "title": _str(c, "title", p, errors, max_len=200),
            "linkedin_url": _str(c, "linkedin_url", p, errors, max_len=500),
            "email_guess": _str(c, "email_guess", p, errors, max_len=200),
            "email_confidence": _str(c, "email_confidence", p, errors),
            "why": _str(c, "why", p, errors, max_len=500),
            "draft_subject": _str(c, "draft_subject", p, errors, required=True, max_len=150),
            "draft_body": _str(c, "draft_body", p, errors, required=True, max_len=3000),
        }
        if row["linkedin_url"] and not row["linkedin_url"].startswith(("https://", "http://")):
            errors.append(f"{p}.linkedin_url: must start with https://")
        if row["email_guess"] and "@" not in row["email_guess"]:
            errors.append(f"{p}.email_guess: not an email address")
        if row["email_confidence"] is None and row["email_guess"]:
            errors.append(f"{p}.email_confidence: required when email_guess is set (verified, pattern or guess)")
        elif row["email_confidence"] is not None and row["email_confidence"] not in CONFIDENCE:
            errors.append(f"{p}.email_confidence: must be one of verified, pattern, guess")
        if row["draft_body"]:
            words = len(row["draft_body"].split())
            if words > WORD_TARGET:
                warnings.append(f"{p}.draft_body: {words} words (aim for under {WORD_TARGET})")
        clean.append(row)
    if errors:
        raise InputError("\n".join(errors))
    return {"company": company, "role": role, "contacts": clean}, warnings


def validate_ideas(data: Any) -> list[dict]:
    if not isinstance(data, list) or not data:
        raise InputError('expected a non-empty JSON list like [{"text": "...", "size": "S"}]')
    errors: list[str] = []
    if len(data) > MAX_IDEAS:
        errors.append(f"$: at most {MAX_IDEAS} ideas")
    out = []
    for i, idea in enumerate(data[:MAX_IDEAS]):
        p = f"$[{i}]"
        if not isinstance(idea, dict):
            errors.append(f"{p}: must be an object")
            continue
        text = _str(idea, "text", p, errors, required=True, max_len=200)
        size = idea.get("size", "S")
        if size not in SIZES:
            errors.append(f"{p}.size: must be S or M")
        out.append({"text": text, "size": size})
    if errors:
        raise InputError("\n".join(errors))
    return out


def save_outreach(db, outreach_id: str, data: dict) -> int:
    rows = db.select("outreach", {"id": outreach_id})
    if not rows:
        raise InputError(f"no outreach request with id {outreach_id}")
    o = rows[0]
    db.delete("contacts", {"outreach_id": outreach_id})
    db.insert("contacts", [{**c, "outreach_id": outreach_id} for c in data["contacts"]])
    patch: dict = {}
    if o.get("status") == "queued":
        patch["status"] = "drafted"
    if not o.get("company") and data["company"]:
        patch["company"] = data["company"]
    if not o.get("role") and data["role"]:
        patch["role"] = data["role"]
    if patch:
        db.update("outreach", {"id": outreach_id}, patch)
    return len(data["contacts"])


def save_ideas(db, project_id: str, ideas: list[dict]) -> tuple[int, int]:
    if not db.select("projects", {"id": project_id}):
        raise InputError(f"no project with id {project_id!r}")
    existing = db.select("ideas", {"project_id": project_id})
    seen = {str(i["text"]).strip().lower() for i in existing if i.get("status") in ("todo", "today")}
    pos = max((int(i.get("position") or 0) for i in existing), default=-1) + 1
    new = []
    for idea in ideas:
        key = idea["text"].lower()
        if key in seen:
            continue
        seen.add(key)
        new.append({"project_id": project_id, "text": idea["text"], "size": idea["size"],
                    "status": "todo", "source": "claude", "position": pos})
        pos += 1
    db.insert("ideas", new)
    return len(new), len(ideas) - len(new)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def main(argv=None, stdin=None, stdout=None, stderr=None, db_factory=creds.make_db) -> int:
    stdin, stdout, stderr = stdin or sys.stdin, stdout or sys.stdout, stderr or sys.stderr
    ap = argparse.ArgumentParser(prog="lockin", description="Save Claude Code results into Lock In.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    so = sub.add_parser("save-outreach", help="read contacts JSON on stdin")
    so.add_argument("--id", required=True, help="outreach id from the prompt")
    si = sub.add_parser("save-ideas", help="read ideas JSON list on stdin")
    si.add_argument("--project", required=True, help="project id, e.g. 27b")
    sub.add_parser("doctor", help="check Keychain credentials and the database connection")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "doctor":
            db = db_factory()
            db.select("settings")
            queued = len(db.select("launch_requests", {"status": "queued"}))
            print(f"OK: connected to Supabase, {_plural(queued, 'queued launch request')}", file=stdout)
            return 0
        payload = parse_json(stdin.read())
        if args.cmd == "save-outreach":
            data, warnings = validate_outreach(payload)
            for w in warnings:
                print(f"warning: {w}", file=stderr)
            n = save_outreach(db_factory(), args.id, data)
            print(f"Saved {_plural(n, 'contact')}", file=stdout)
        else:
            saved, skipped = save_ideas(db_factory(), args.project, validate_ideas(payload))
            tail = f" ({_plural(skipped, 'duplicate')} skipped)" if skipped else ""
            print(f"Saved {_plural(saved, 'idea')}{tail}", file=stdout)
        return 0
    except InputError as e:
        print(f"error: {e}", file=stderr)
        return 2
    except (creds.CredsError, DBError) as e:
        print(f"error: {e}", file=stderr)
        return 1


def main_entry() -> None:
    sys.exit(main())
```

- [ ] **Step 8: Add the console scripts**

Append to `worker/pyproject.toml` (after the `[project.optional-dependencies]` table):
```toml
[project.scripts]
lockin = "lockin_worker.cli:main_entry"
lockin-launcher = "lockin_worker.launcher:main"
```
Re-install so the scripts exist: `cd worker && .venv/bin/pip install -q -e '.[dev]'`.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `cd worker && .venv/bin/pytest tests/test_creds.py tests/test_cli.py -v`
Expected: 18 passed. Then `.venv/bin/lockin --help` prints the three subcommands.

- [ ] **Step 10: Commit**

```bash
git add worker/lockin_worker/creds.py worker/lockin_worker/cli.py worker/tests/test_creds.py worker/tests/test_cli.py worker/pyproject.toml
git commit -m "Add lockin CLI to save outreach drafts and project ideas"
```

---

### Task 3: Resume matching with iCloud download

**Files:**
- Create: `worker/lockin_worker/resume.py`, `worker/tests/test_resume.py`

**Interfaces:**
- Produces:
  - `resume.BASE_RELATIVE = Path("Base_Resume/Adam_Kuhn_Resume.pdf")`
  - `resume.normalize_company(name: str) -> str` (tokens joined by `_`, lowercase, corporate suffixes dropped)
  - `resume.folder_matches(folder_name: str, company_norm: str) -> bool`
  - `resume.company_from_url(url: str) -> str | None`
  - `resume.ensure_local(path: Path, run=subprocess.run) -> bool`
  - `resume.ResumeChoice(path: Path, note: str, folder: Path | None)` (frozen dataclass)
  - `resume.find_resume(root: Path | str, company: str | None, run=subprocess.run) -> ResumeChoice`

Matching rule (spec §8 "starts with", made precise): split the normalized folder name into `_` tokens. It matches when the company's tokens are a prefix of the folder's tokens, or when the company with separators removed equals the first k folder tokens joined (so `JPMorgan` matches `JP_Morgan_SWE` but `Apple` does not match `Applied_Systems_…`). `Base_Resume` never matches.

- [ ] **Step 1: Write the failing tests**

`worker/tests/test_resume.py`:
```python
import os
import subprocess
from pathlib import Path
from lockin_worker import resume


def ok_run(argv, **kw):
    return subprocess.CompletedProcess(argv, 0, "", "")


def make(root: Path, folder: str, files=("Adam_Kuhn_Resume.pdf",), mtime: int = 1_700_000_000) -> Path:
    d = root / folder
    d.mkdir(parents=True)
    for f in files:
        (d / f).write_text("x")
    os.utime(d, (mtime, mtime))
    return d


def tree(tmp_path):
    root = tmp_path / "Adam_Kuhn_Resumes"
    make(root, "Base_Resume")
    return root


def test_normalize_company():
    assert resume.normalize_company("Stripe, Inc.") == "stripe"
    assert resume.normalize_company("The Trade Desk") == "trade_desk"
    assert resume.normalize_company("JPMorgan Chase & Co.") == "jpmorgan_chase"
    assert resume.normalize_company("Palantir Technologies") == "palantir"
    assert resume.normalize_company("AT&T") == "at_t"
    assert resume.normalize_company("scale-ai") == "scale_ai"
    assert resume.normalize_company("  ") == ""


def test_folder_matches():
    assert resume.folder_matches("Amazon_SDE_Intern_2027", "amazon")
    assert resume.folder_matches("American_Express_2027_SWE", "american_express")
    assert resume.folder_matches("JP_Morgan_SWE", "jpmorgan")
    assert not resume.folder_matches("Applied_Systems_Associate_Software_Engineer", "apple")
    assert not resume.folder_matches("Amazon_SDE_Intern_2027", "amaz")


def test_company_from_url():
    f = resume.company_from_url
    assert f("https://boards.greenhouse.io/stripe/jobs/123") == "stripe"
    assert f("https://job-boards.greenhouse.io/scaleai/jobs/9") == "scaleai"
    assert f("https://boards.greenhouse.io/embed/job_app?for=ramp&token=1") == "ramp"
    assert f("https://jobs.lever.co/palantir/abc") == "palantir"
    assert f("https://jobs.ashbyhq.com/ramp/xyz") == "ramp"
    assert f("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x") == "nvidia"
    assert f("https://www.amazon.jobs/en/jobs/123") == "amazon"
    assert f("https://careers.microsoft.com/us/en/job/1") == "microsoft"
    assert f("not a url") is None


def test_single_match_prefers_pdf(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE_Intern_2027", files=("Adam_Kuhn_Resume.tex", "Adam_Kuhn_Resume.pdf"))
    c = resume.find_resume(root, "Stripe", run=ok_run)
    assert c.path == root / "Stripe_SWE_Intern_2027" / "Adam_Kuhn_Resume.pdf"
    assert c.note == "Matched resume folder Stripe_SWE_Intern_2027."


def test_tex_when_no_pdf(tmp_path):
    root = tree(tmp_path)
    make(root, "Ramp_SWE", files=("resume.tex",))
    assert resume.find_resume(root, "Ramp", run=ok_run).path.name == "resume.tex"


def test_multiple_matches_newest_and_lists_others(tmp_path):
    root = tree(tmp_path)
    make(root, "Amazon_Annapurna_SDE_I_Early_Career_2027", mtime=1_700_000_000)
    make(root, "Amazon_SDE_Intern_2027", mtime=1_800_000_000)
    c = resume.find_resume(root, "Amazon", run=ok_run)
    assert c.folder.name == "Amazon_SDE_Intern_2027"
    assert "Other matches" in c.note and "Amazon_Annapurna_SDE_I_Early_Career_2027" in c.note


def test_no_match_uses_base(tmp_path):
    root = tree(tmp_path)
    c = resume.find_resume(root, "Figma", run=ok_run)
    assert c.path == root / "Base_Resume" / "Adam_Kuhn_Resume.pdf" and c.folder is None
    assert "No resume folder for Figma" in c.note and "base resume" in c.note


def test_unknown_company_uses_base(tmp_path):
    c = resume.find_resume(tree(tmp_path), None, run=ok_run)
    assert "Company unknown" in c.note


def test_icloud_placeholder_downloaded(tmp_path):
    root = tree(tmp_path)
    d = make(root, "Stripe_SWE", files=(".Adam_Kuhn_Resume.pdf.icloud",))
    target = d / "Adam_Kuhn_Resume.pdf"

    def brctl(argv, **kw):
        assert argv == ["brctl", "download", str(target)]
        target.write_text("pdf")
        return subprocess.CompletedProcess(argv, 0, "", "")

    assert resume.find_resume(root, "Stripe", run=brctl).path == target


def test_icloud_download_fails_falls_back(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE", files=(".Adam_Kuhn_Resume.pdf.icloud",))

    def missing_brctl(argv, **kw):
        raise FileNotFoundError("brctl")

    c = resume.find_resume(root, "Stripe", run=missing_brctl)
    assert c.path.parent.name == "Base_Resume" and "couldn't be downloaded" in c.note


def test_unreadable_root_falls_back(tmp_path):
    c = resume.find_resume(tmp_path / "does-not-exist", "Stripe", run=ok_run)
    assert c.path.name == "Adam_Kuhn_Resume.pdf" and "Couldn't read" in c.note


def test_folder_without_resume_file(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE", files=("notes.txt",))
    assert "has no .pdf or .tex" in resume.find_resume(root, "Stripe", run=ok_run).note


def test_tilde_root_expanded(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    make(tmp_path / "R", "Stripe_SWE")
    assert resume.find_resume("~/R", "Stripe", run=ok_run).folder == tmp_path / "R" / "Stripe_SWE"
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd worker && .venv/bin/pytest tests/test_resume.py -v`
Expected: FAIL with `ImportError: cannot import name 'resume'`.

- [ ] **Step 3: Implement `resume.py`**

`worker/lockin_worker/resume.py`:
```python
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_RELATIVE = Path("Base_Resume") / "Adam_Kuhn_Resume.pdf"
SUFFIXES = {"inc", "incorporated", "llc", "ltd", "co", "corp", "corporation", "company", "plc", "gmbh",
            "technologies", "technology", "labs", "group", "holdings"}
GENERIC_LABELS = {"www", "careers", "career", "jobs", "job", "apply", "boards", "en", "us"}
ATS_FIRST_PATH = ("greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com")


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def normalize_company(name: str) -> str:
    toks = _tokens(name or "")
    if toks and toks[0] == "the":
        toks = toks[1:]
    while len(toks) > 1 and toks[-1] in SUFFIXES:
        toks = toks[:-1]
    return "_".join(toks)


def folder_matches(folder_name: str, company_norm: str) -> bool:
    if not company_norm:
        return False
    ftoks = _tokens(folder_name)
    ctoks = company_norm.split("_")
    if ftoks[: len(ctoks)] == ctoks:
        return True
    compact = "".join(ctoks)
    return any("".join(ftoks[:k]) == compact for k in range(1, len(ftoks) + 1))


def company_from_url(url: str) -> str | None:
    u = urlparse(url or "")
    host = (u.hostname or "").lower()
    if not host or "." not in host:
        return None
    parts = [p for p in u.path.split("/") if p]
    if host.endswith(ATS_FIRST_PATH):
        if parts and parts[0] == "embed":
            return (parse_qs(u.query).get("for") or [None])[0]
        return parts[0] if parts else None
    if host.endswith(".myworkdayjobs.com"):
        return host.split(".")[0]
    labels = host.split(".")[:-1]  # drop the TLD
    labels = [x for x in labels if x not in GENERIC_LABELS]
    return labels[-1] if labels else None


def _real_name(p: Path) -> str | None:
    n = p.name
    if n.startswith(".") and n.endswith(".icloud"):
        return n[1:-len(".icloud")]  # iCloud placeholder for an evicted file
    return None if n.startswith(".") else n


def _resume_file(folder: Path) -> Path | None:
    entries = [(p, _real_name(p)) for p in folder.iterdir() if p.is_file()]
    for ext in (".pdf", ".tex"):
        cands = [(p, n) for p, n in entries if n and n.lower().endswith(ext)]
        if cands:
            _, name = max(cands, key=lambda t: t[0].stat().st_mtime)
            return folder / name
    return None


def ensure_local(path: Path, run=subprocess.run) -> bool:
    try:
        run(["brctl", "download", str(path)], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        pass  # best effort: brctl missing, timed out, or not an iCloud path
    return path.exists()


@dataclass(frozen=True)
class ResumeChoice:
    path: Path
    note: str
    folder: Path | None


def find_resume(root: Path | str, company: str | None, run=subprocess.run) -> ResumeChoice:
    root = Path(os.path.expanduser(str(root)))
    base = root / BASE_RELATIVE

    def fallback(note: str) -> ResumeChoice:
        ensure_local(base, run)
        return ResumeChoice(base, note, None)

    comp = normalize_company(company or "")
    if not comp:
        return fallback("Company unknown, so no tailored resume was matched. Using the base resume.")
    try:
        folders = [p for p in root.iterdir()
                   if p.is_dir() and p.name != "Base_Resume" and folder_matches(p.name, comp)]
    except OSError as e:
        return fallback(f"Couldn't read {root} ({e.strerror or e}). Using the base resume; "
                        f"check that folder for a {company} resume yourself.")
    if not folders:
        return fallback(f"No resume folder for {company} under {root}. Using the base resume.")
    folders.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    chosen = folders[0]
    f = _resume_file(chosen)
    if f is None:
        return fallback(f"{chosen.name} has no .pdf or .tex. Using the base resume.")
    if not ensure_local(f, run):
        return fallback(f"{f} is in iCloud and couldn't be downloaded. Using the base resume.")
    note = f"Matched resume folder {chosen.name}."
    if len(folders) > 1:
        others = ", ".join(p.name for p in folders[1:])
        note += f" Other matches (newest first; use one of these instead if it fits the posting better): {others}."
    return ResumeChoice(f, note, chosen)
```
Note on `test_single_match_prefers_pdf`: the note for one match has no "Other matches" sentence, so it equals exactly `"Matched resume folder Stripe_SWE_Intern_2027."`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd worker && .venv/bin/pytest tests/test_resume.py -v`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/lockin_worker/resume.py worker/tests/test_resume.py
git commit -m "Add resume folder matching with iCloud download fallback"
```

---

### Task 4: Terminal opener and the launcher poll loop

**Files:**
- Create: `worker/lockin_worker/terminal.py`, `worker/lockin_worker/launcher.py`, `worker/tests/test_terminal.py`, `worker/tests/test_launcher.py`

**Interfaces:**
- Consumes: `prompts.load/render` (Task 1), `creds.make_db/CredsError` (Task 2), `resume.find_resume/company_from_url/ResumeChoice` (Task 3), `db.DBError`
- Produces:
  - `terminal.PROMPT_DIR` (`~/Library/Caches/lockin/prompts`)
  - `terminal.write_prompt(text: str, name: str, directory: Path = PROMPT_DIR) -> Path`
  - `terminal.shell_command(cwd: Path, prompt_file: Path, program: str = "claude") -> str`
  - `terminal.applescript_string(s: str) -> str`
  - `terminal.osascript_argv(command: str) -> list[str]`
  - `terminal.TerminalError(Exception)`
  - `terminal.open_in_terminal(cwd: Path, prompt: str, name: str, run=subprocess.run, directory: Path = PROMPT_DIR) -> Path`
  - `launcher.POLL_SECONDS = 10`
  - `launcher.LaunchError(Exception)`
  - `launcher.build_outreach(db, payload: dict, lockin: str, find=resume.find_resume) -> tuple[Path, str]`
  - `launcher.build_suggest(db, payload: dict, lockin: str) -> tuple[Path, str]`
  - `launcher.process(db, req: dict, opener, lockin: str, find=resume.find_resume) -> str` (`"launched"` | `"failed"`)
  - `launcher.poll_once(db, opener, lockin: str, find=resume.find_resume) -> list[tuple[str, str]]`
  - `launcher.run_forever(make_db, opener, sleep=time.sleep, iterations: int | None = None, lockin: str | None = None, find=resume.find_resume) -> None`
  - `launcher.main() -> None`
  - Opener contract: `opener(cwd: Path, prompt: str, name: str)`; raises on failure. `terminal.open_in_terminal` satisfies it.

- [ ] **Step 1: Write failing terminal tests**

`worker/tests/test_terminal.py`:
```python
import subprocess
import sys
import pytest
from lockin_worker import terminal

HOSTILE = "Job: https://x.com/j?a=1&b='q'\nSay \"hi\" — cost $5, `whoami`, $(rm -rf ~) \\n tab\there\n"


def test_write_prompt_exact_and_named(tmp_path):
    p = terminal.write_prompt(HOSTILE, "abc-123/../x", tmp_path)
    assert p.parent == tmp_path and p.name == "lockin-prompt-abc-123x.md"
    assert p.read_text(encoding="utf-8") == HOSTILE


def test_shell_command_roundtrip_hostile_prompt(tmp_path):
    cwd = tmp_path / "dir with 'quote' and $HOME"
    cwd.mkdir()
    f = terminal.write_prompt(HOSTILE, "r1", tmp_path)
    cmd = terminal.shell_command(cwd, f, program="printf %s")
    assert HOSTILE.strip() not in cmd  # the prompt never enters the command line
    out = subprocess.run(["/bin/zsh" if sys.platform == "darwin" else "/bin/sh", "-c", cmd],
                         capture_output=True, text=True, check=True).stdout
    assert out == HOSTILE.rstrip("\n")  # $(...) strips trailing newlines only


def test_shell_command_shape(tmp_path):
    cmd = terminal.shell_command(tmp_path / "a b", tmp_path / "p.md")
    assert cmd == f"cd '{tmp_path}/a b' && claude \"$(cat {tmp_path}/p.md)\""


def test_applescript_string_escapes():
    assert terminal.applescript_string('a "b" \\c') == '"a \\"b\\" \\\\c"'


@pytest.mark.skipif(sys.platform != "darwin", reason="needs osascript")
def test_applescript_string_roundtrip(tmp_path):
    cmd = terminal.shell_command(tmp_path / "it's \"x\"", tmp_path / "p.md")
    out = subprocess.run(["osascript", "-e", f"return {terminal.applescript_string(cmd)}"],
                         capture_output=True, text=True, check=True).stdout
    assert out.rstrip("\n") == cmd


def test_osascript_argv():
    argv = terminal.osascript_argv('cd /x && claude "$(cat /p)"')
    assert argv == ["osascript", "-e", 'tell application "Terminal"',
                    "-e", 'do script "cd /x && claude \\"$(cat /p)\\""',
                    "-e", "activate", "-e", "end tell"]


def test_open_in_terminal_runs_osascript(tmp_path):
    calls = []

    def run(argv, **kw):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "", "")

    f = terminal.open_in_terminal(tmp_path, "hello", "r9", run=run, directory=tmp_path)
    assert calls[0][0] == "osascript" and str(f) in calls[0][4]


def test_open_in_terminal_error(tmp_path):
    def run(argv, **kw):
        return subprocess.CompletedProcess(argv, 1, "", "execution error: Not authorized to send Apple events to Terminal. (-1743)")

    with pytest.raises(terminal.TerminalError, match="Not authorized"):
        terminal.open_in_terminal(tmp_path, "hello", "r9", run=run, directory=tmp_path)
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd worker && .venv/bin/pytest tests/test_terminal.py -v`
Expected: FAIL with `ImportError: cannot import name 'terminal'`.

- [ ] **Step 3: Implement `terminal.py`**

`worker/lockin_worker/terminal.py`:
```python
from __future__ import annotations

import re
import shlex
import subprocess
import time
from pathlib import Path

PROMPT_DIR = Path.home() / "Library" / "Caches" / "lockin" / "prompts"
KEEP_DAYS = 7


class TerminalError(Exception):
    pass


def write_prompt(text: str, name: str, directory: Path = PROMPT_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - KEEP_DAYS * 86400
    for old in directory.glob("lockin-prompt-*.md"):
        if old.stat().st_mtime < cutoff:
            old.unlink(missing_ok=True)
    safe = re.sub(r"[^A-Za-z0-9-]", "", name) or "prompt"
    path = directory / f"lockin-prompt-{safe}.md"
    path.write_text(text, encoding="utf-8")
    return path


def shell_command(cwd: Path, prompt_file: Path, program: str = "claude") -> str:
    # `program` is a trusted constant; everything that varies is quoted.
    return f'cd {shlex.quote(str(cwd))} && {program} "$(cat {shlex.quote(str(prompt_file))})"'


def applescript_string(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def osascript_argv(command: str) -> list[str]:
    return ["osascript", "-e", 'tell application "Terminal"',
            "-e", f"do script {applescript_string(command)}",
            "-e", "activate", "-e", "end tell"]


def open_in_terminal(cwd: Path, prompt: str, name: str, run=subprocess.run,
                     directory: Path = PROMPT_DIR) -> Path:
    f = write_prompt(prompt, name, directory)
    r = run(osascript_argv(shell_command(cwd, f)), capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise TerminalError(f"osascript failed ({r.returncode}): {(r.stderr or '').strip()[:300]}")
    return f
```
`test_shell_command_shape`: `shlex.quote` leaves a path with no special characters unquoted (`{tmp_path}/p.md`) and single-quotes one with a space. pytest's `tmp_path` contains only safe characters, so the expected string holds.

- [ ] **Step 4: Run the terminal tests and confirm they pass**

Run: `cd worker && .venv/bin/pytest tests/test_terminal.py -v`
Expected: 8 passed (7 on non-macOS, 1 skipped).

- [ ] **Step 5: Write failing launcher tests**

`worker/tests/test_launcher.py`:
```python
from pathlib import Path
import pytest
from lockin_worker import launcher
from lockin_worker.db import MemoryDB, DBError
from lockin_worker.resume import ResumeChoice

OID = "o-1"


class Opener:
    def __init__(self, fail: Exception | None = None, db=None):
        self.calls, self.fail, self.db, self.status_at_open = [], fail, db, None

    def __call__(self, cwd, prompt, name):
        if self.db is not None:
            self.status_at_open = self.db.select("launch_requests", {"id": name})[0]["status"]
        self.calls.append((cwd, prompt, name))
        if self.fail:
            raise self.fail


def fake_find(root, company):
    return ResumeChoice(Path("/R/Stripe_SWE/Adam_Kuhn_Resume.pdf"), f"Matched for {company}.", Path("/R/Stripe_SWE"))


def db_fixture(tmp_path):
    db = MemoryDB()
    db.insert("settings", [{"resume_root": "/R"}])
    db.insert("outreach", [{"id": OID, "job_url": "https://boards.greenhouse.io/stripe/jobs/1", "status": "queued",
                            "company": None, "role": None}])
    db.insert("postings", [{"id": "p1", "url": "https://boards.greenhouse.io/stripe/jobs/1", "company": "Stripe", "title": "SWE Intern"}])
    proj = tmp_path / "27b"
    proj.mkdir()
    db.insert("projects", [{"id": "27b", "name": "27B", "repo": "adamkuhn1/27b", "local_path": str(proj), "active": True}])
    db.insert("launch_requests", [
        {"id": "r2", "kind": "suggest_ideas", "payload": {"project_id": "27b"}, "status": "queued", "created_at": "2026-10-14T12:01:00Z"},
        {"id": "r1", "kind": "outreach", "payload": {"outreach_id": OID, "job_url": "https://boards.greenhouse.io/stripe/jobs/1"},
         "status": "queued", "created_at": "2026-10-14T12:00:00Z"},
        {"id": "r0", "kind": "outreach", "payload": {}, "status": "launched", "created_at": "2026-10-14T11:00:00Z"},
    ])
    return db


def status(db, rid):
    return db.select("launch_requests", {"id": rid})[0]


def test_poll_once_processes_queued_oldest_first(tmp_path):
    db = db_fixture(tmp_path)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin", find=fake_find) == [("r1", "launched"), ("r2", "launched")]
    assert [c[2] for c in op.calls] == ["r1", "r2"]
    assert status(db, "r1")["status"] == "launched" and status(db, "r2")["status"] == "launched"


def test_outreach_prompt_and_outreach_row(tmp_path):
    db = db_fixture(tmp_path)
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin", find=fake_find)
    cwd, prompt, _ = op.calls[0]
    assert cwd == Path.home()
    assert "/v/bin/lockin save-outreach --id o-1 <<'JSON'" in prompt
    assert "Resume to use: /R/Stripe_SWE/Adam_Kuhn_Resume.pdf" in prompt and "Matched for Stripe." in prompt
    assert "{{" not in prompt
    o = db.select("outreach", {"id": OID})[0]
    assert o["resume_path"] == "/R/Stripe_SWE/Adam_Kuhn_Resume.pdf" and o["company"] == "Stripe"


def test_outreach_without_posting_uses_url_company_but_does_not_store_slug(tmp_path):
    db = db_fixture(tmp_path)
    db.delete("postings")
    seen = []
    launcher.poll_once(db, Opener(), "lockin", find=lambda root, c: (seen.append(c), fake_find(root, c))[1])
    assert seen[0] == "stripe" and db.select("outreach", {"id": OID})[0]["company"] is None


def test_suggest_prompt_runs_in_project_dir(tmp_path):
    db = db_fixture(tmp_path)
    op = Opener()
    launcher.poll_once(db, op, "lockin", find=fake_find)
    cwd, prompt, _ = op.calls[1]
    assert cwd == tmp_path / "27b"
    assert "lockin save-ideas --project 27b <<'JSON'" in prompt and "27B (adamkuhn1/27b)" in prompt


def test_marked_launched_before_open(tmp_path):
    db = db_fixture(tmp_path)
    op = Opener(db=db)
    launcher.process(db, status(db, "r1"), op, "lockin", find=fake_find)
    assert op.status_at_open == "launched"


def test_opener_error_marks_failed_and_not_retried(tmp_path):
    db = db_fixture(tmp_path)
    op = Opener(fail=RuntimeError("osascript failed (1): Not authorized"))
    assert launcher.process(db, status(db, "r1"), op, "lockin", find=fake_find) == "failed"
    r = status(db, "r1")
    assert r["status"] == "failed" and "Not authorized" in r["error"]
    op2 = Opener()
    launcher.poll_once(db, op2, "lockin", find=fake_find)
    assert "r1" not in [c[2] for c in op2.calls]


def test_missing_project_dir_fails_with_message(tmp_path):
    db = db_fixture(tmp_path)
    db.update("projects", {"id": "27b"}, {"local_path": str(tmp_path / "gone")})
    launcher.process(db, status(db, "r2"), Opener(), "lockin", find=fake_find)
    assert "doesn't exist on this Mac" in status(db, "r2")["error"]


def test_unknown_kind_and_missing_outreach(tmp_path):
    db = db_fixture(tmp_path)
    db.insert("launch_requests", [{"id": "r9", "kind": "dance", "payload": {}, "status": "queued", "created_at": "z"}])
    launcher.process(db, status(db, "r9"), Opener(), "lockin", find=fake_find)
    assert "unknown kind 'dance'" in status(db, "r9")["error"]
    db.update("launch_requests", {"id": "r1"}, {"payload": {"outreach_id": "nope"}})
    launcher.process(db, status(db, "r1"), Opener(), "lockin", find=fake_find)
    assert "outreach 'nope' not found" in status(db, "r1")["error"]


def test_error_text_truncated(tmp_path):
    db = db_fixture(tmp_path)
    launcher.process(db, status(db, "r1"), Opener(fail=RuntimeError("x" * 2000)), "lockin", find=fake_find)
    assert len(status(db, "r1")["error"]) == 500


def test_run_forever_survives_errors(tmp_path):
    attempts, sleeps = [], []

    def make_db():
        attempts.append(1)
        if len(attempts) == 1:
            raise DBError("GET settings: HTTP 503")
        return db_fixture(tmp_path)

    op = Opener()
    launcher.run_forever(make_db, op, sleep=sleeps.append, iterations=3, lockin="lockin", find=fake_find)
    assert sleeps == [10, 10, 10] and len(op.calls) == 2  # recovered on iteration 2, nothing queued on 3
    assert len(attempts) == 2  # a working db is reused, not rebuilt every poll
```
`run_forever` takes `find` so this test never shells out to the real `brctl`.

- [ ] **Step 6: Run them and confirm they fail**

Run: `cd worker && .venv/bin/pytest tests/test_launcher.py -v`
Expected: FAIL with `ImportError: cannot import name 'launcher'`.

- [ ] **Step 7: Implement `launcher.py`**

`worker/lockin_worker/launcher.py`:
```python
from __future__ import annotations

import os
import sys
import time
from datetime import datetime
from pathlib import Path

from . import creds, prompts, resume, terminal

POLL_SECONDS = 10
DEFAULT_ROOT = "~/Desktop/Adam_Kuhn_Resumes"
ERROR_MAX = 500


class LaunchError(Exception):
    pass


def log(msg: str) -> None:
    print(f"{datetime.now().isoformat(timespec='seconds')} {msg}", flush=True)


def lockin_bin() -> str:
    cand = Path(sys.executable).with_name("lockin")
    return str(cand) if cand.exists() else "lockin"


def build_outreach(db, payload: dict, lockin: str, find=resume.find_resume) -> tuple[Path, str]:
    oid = payload.get("outreach_id")
    rows = db.select("outreach", {"id": oid}) if oid else []
    if not rows:
        raise LaunchError(f"outreach {oid!r} not found")
    o = rows[0]
    job_url = o.get("job_url") or payload.get("job_url") or ""
    posting = next(iter(db.select("postings", {"url": job_url})), None) if job_url else None
    display_company = o.get("company") or (posting or {}).get("company")
    match_company = display_company or resume.company_from_url(job_url)
    settings = (db.select("settings") or [{}])[0]
    choice = find(settings.get("resume_root") or DEFAULT_ROOT, match_company)
    patch = {"resume_path": str(choice.path)}
    if display_company and not o.get("company"):
        patch["company"] = display_company
    if posting and not o.get("role") and posting.get("title"):
        patch["role"] = posting["title"]
    db.update("outreach", {"id": oid}, patch)
    text = prompts.render(prompts.load("outreach"), {
        "outreach_id": oid, "job_url": job_url,
        "company": display_company or match_company or "unknown (read it from the posting)",
        "resume_path": str(choice.path), "resume_note": choice.note, "lockin": lockin,
    })
    return Path.home(), text


def build_suggest(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    pid = payload.get("project_id")
    rows = db.select("projects", {"id": pid}) if pid else []
    if not rows:
        raise LaunchError(f"project {pid!r} not found")
    p = rows[0]
    if not p.get("local_path"):
        raise LaunchError(f"project {p['name']} has no local folder; set local_path in Settings")
    cwd = Path(os.path.expanduser(p["local_path"]))
    if not cwd.is_dir():
        raise LaunchError(f"{cwd} doesn't exist on this Mac")
    text = prompts.render(prompts.load("suggest_ideas"), {
        "project_id": pid, "project_name": p["name"], "repo": p["repo"], "lockin": lockin})
    return cwd, text


BUILDERS = {"outreach": build_outreach, "suggest_ideas": build_suggest}


def process(db, req: dict, opener, lockin: str, find=resume.find_resume) -> str:
    rid = req["id"]
    # Mark first: if anything below crashes, this request can never be opened twice.
    db.update("launch_requests", {"id": rid}, {"status": "launched", "error": None})
    try:
        builder = BUILDERS.get(req.get("kind"))
        if builder is None:
            raise LaunchError(f"unknown kind {req.get('kind')!r}")
        cwd, text = builder(db, req.get("payload") or {}, lockin, find=find)
        opener(cwd, text, rid)
        log(f"launched {req['kind']} {rid} in {cwd}")
        return "launched"
    except Exception as exc:  # report every failure on the request itself
        msg = f"{type(exc).__name__}: {exc}"[:ERROR_MAX]
        log(f"failed {rid}: {msg}")
        db.update("launch_requests", {"id": rid}, {"status": "failed", "error": msg})
        return "failed"


def poll_once(db, opener, lockin: str, find=resume.find_resume) -> list[tuple[str, str]]:
    queued = sorted(db.select("launch_requests", {"status": "queued"}), key=lambda r: str(r.get("created_at") or ""))
    return [(r["id"], process(db, r, opener, lockin, find=find)) for r in queued]


def run_forever(make_db, opener, sleep=time.sleep, iterations: int | None = None, lockin: str | None = None,
                find=resume.find_resume) -> None:
    lockin = lockin or lockin_bin()
    db = None
    n = 0
    while iterations is None or n < iterations:
        n += 1
        try:
            if db is None:
                db = make_db()
            poll_once(db, opener, lockin, find=find)
        except Exception as exc:  # DB down, Keychain locked, network gone after sleep
            log(f"poll failed: {type(exc).__name__}: {exc}")
            if isinstance(exc, creds.CredsError):
                db = None
        sleep(POLL_SECONDS)


def main() -> None:
    log("lockin launcher started")
    run_forever(creds.make_db, terminal.open_in_terminal)


if __name__ == "__main__":
    main()
```
`process` passes `find=find` to both builders, which is why `build_suggest` accepts and ignores a `find` keyword. In `test_run_forever_survives_errors`, the first `make_db` raises `DBError` before `db` is assigned, so `db` stays `None` and the next iteration builds it again; after that, the working `db` is reused.

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `cd worker && .venv/bin/pytest tests/test_terminal.py tests/test_launcher.py -v`
Expected: all pass (one skip off macOS). Then the full suite: `.venv/bin/pytest -q` → all pass.

- [ ] **Step 9: Commit**

```bash
git add worker/lockin_worker/terminal.py worker/lockin_worker/launcher.py worker/tests/test_terminal.py worker/tests/test_launcher.py
git commit -m "Add Mac launcher: poll launch requests and open Claude in Terminal"
```

---

### Task 5: Install: LaunchAgent plist, Makefile, Keychain helper, setup docs

**Files:**
- Create: `worker/lockin_worker/install.py`, `worker/tests/test_install.py`, `Makefile`, `scripts/keychain.sh`
- Modify: `docs/setup.md` (append a "Mac launcher" section; create the file with a `# Lock In setup` heading if Plan 1 Task 12 hasn't yet)

**Interfaces:**
- Consumes: `launcher.main` via `python -m lockin_worker.launcher` (Task 4)
- Produces:
  - `install.LABEL = "com.adamkuhn.lockin.launcher"`
  - `install.plist_dict(python: str, home: Path) -> dict`
  - `install.write_plist(path: Path, python: str, home: Path) -> None`
  - `install.main(argv=None) -> int` (`python -m lockin_worker.install --plist <path>`)
  - make targets `install-launcher`, `uninstall-launcher`, `keychain`, `launcher-status`

- [ ] **Step 1: Write the failing tests**

`worker/tests/test_install.py`:
```python
import plistlib
import subprocess
from pathlib import Path
from lockin_worker import install

REPO = Path(__file__).resolve().parents[2]


def test_plist_dict():
    d = install.plist_dict("/Users/a/.lockin/venv/bin/python", Path("/Users/a"))
    assert d["Label"] == "com.adamkuhn.lockin.launcher"
    assert d["ProgramArguments"] == ["/Users/a/.lockin/venv/bin/python", "-m", "lockin_worker.launcher"]
    assert d["RunAtLoad"] is True and d["KeepAlive"] is True
    assert d["StandardOutPath"] == d["StandardErrorPath"] == "/Users/a/Library/Logs/lockin-launcher.log"
    assert d["EnvironmentVariables"]["PYTHONUNBUFFERED"] == "1"
    assert "/usr/bin" in d["EnvironmentVariables"]["PATH"]


def test_write_plist_is_valid(tmp_path):
    p = tmp_path / "LaunchAgents" / "x.plist"
    install.write_plist(p, "/py", Path("/Users/a"))
    assert plistlib.loads(p.read_bytes())["Label"] == install.LABEL


def test_keychain_script_syntax_and_no_echo():
    script = (REPO / "scripts" / "keychain.sh").read_text()
    subprocess.run(["bash", "-n", str(REPO / "scripts" / "keychain.sh")], check=True)
    assert "read -r -s" in script and "set -x" not in script and 'echo "$value"' not in script
    for acct in ("supabase_url", "service_key", "owner_id"):
        assert f"store {acct} " in script


def test_makefile_targets_use_tabs():
    mk = (REPO / "Makefile").read_text()
    for target in ("install-launcher:", "uninstall-launcher:", "keychain:", "launcher-status:"):
        assert target in mk
    assert "\n\tlaunchctl bootstrap gui/$$(id -u) $(PLIST)" in mk
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd worker && .venv/bin/pytest tests/test_install.py -v`
Expected: FAIL with `ImportError: cannot import name 'install'`.

- [ ] **Step 3: Implement `install.py`**

`worker/lockin_worker/install.py`:
```python
from __future__ import annotations

import argparse
import plistlib
import sys
from pathlib import Path

LABEL = "com.adamkuhn.lockin.launcher"


def plist_dict(python: str, home: Path) -> dict:
    log = str(home / "Library" / "Logs" / "lockin-launcher.log")
    return {
        "Label": LABEL,
        "ProgramArguments": [python, "-m", "lockin_worker.launcher"],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "StandardOutPath": log,
        "StandardErrorPath": log,
        "WorkingDirectory": str(home),
        "EnvironmentVariables": {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "PYTHONUNBUFFERED": "1"},
    }


def write_plist(path: Path, python: str, home: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(plistlib.dumps(plist_dict(python, home)))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m lockin_worker.install")
    ap.add_argument("--plist", required=True)
    args = ap.parse_args(argv)
    write_plist(Path(args.plist), sys.executable, Path.home())
    print(f"wrote {args.plist}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```
`sys.executable` is the venv's `bin/python`, because `make install-launcher` runs this module with the venv's interpreter.

- [ ] **Step 4: Write `scripts/keychain.sh`** and `chmod +x scripts/keychain.sh`

```bash
#!/bin/bash
# Stores Lock In's launcher/CLI credentials in the login Keychain (service "lockin").
# Values are read silently and never echoed. Press Enter on a prompt to keep the existing value.
set -euo pipefail

store() {
  local account="$1" prompt="$2" value
  read -r -s -p "$prompt: " value
  echo
  if [ -z "$value" ]; then
    echo "Kept existing $account."
    return
  fi
  security add-generic-password -U -s lockin -a "$account" -T /usr/bin/security -w "$value"
  unset value
  echo "Saved $account."
}

store supabase_url "Supabase URL (https://<ref>.supabase.co)"
store service_key "Supabase service-role key"
store owner_id "Owner user id (LOCKIN_OWNER_ID)"
```
`-T /usr/bin/security` lets the `security` tool read the item later without a Keychain dialog, which matters for a headless LaunchAgent.

- [ ] **Step 5: Write the `Makefile`** (recipe lines start with a TAB)

```make
VENV  := $(HOME)/.lockin/venv
LABEL := com.adamkuhn.lockin.launcher
PLIST := $(HOME)/Library/LaunchAgents/$(LABEL).plist
LOG   := $(HOME)/Library/Logs/lockin-launcher.log

.PHONY: install-launcher uninstall-launcher keychain launcher-status

install-launcher:
	python3.12 -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -e ./worker
	mkdir -p $(HOME)/.local/bin
	ln -sf $(VENV)/bin/lockin $(HOME)/.local/bin/lockin
	$(VENV)/bin/python -m lockin_worker.install --plist $(PLIST)
	-launchctl bootout gui/$$(id -u)/$(LABEL) 2>/dev/null
	launchctl bootstrap gui/$$(id -u) $(PLIST)
	@echo "Installed. Log: $(LOG)"
	@echo "Check: $(VENV)/bin/lockin doctor"

uninstall-launcher:
	-launchctl bootout gui/$$(id -u)/$(LABEL)
	rm -f $(PLIST)

keychain:
	@scripts/keychain.sh

launcher-status:
	@launchctl print gui/$$(id -u)/$(LABEL) | grep -E "state|pid|last exit" || echo "not loaded"
	@tail -n 20 $(LOG) 2>/dev/null || echo "no log yet"
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd worker && .venv/bin/pytest tests/test_install.py -v`
Expected: 4 passed.

- [ ] **Step 7: Append the "Mac launcher" section to `docs/setup.md`**

```markdown
## Mac launcher and `lockin` CLI

Opens Terminal with Claude Code when you tap **Cold email** / **Draft emails** or **Suggest improvements** in the app.

1. Store credentials (values are hidden while you type):
   `make keychain` — Supabase URL, the service-role key (Supabase → Settings → API), and your user id (`LOCKIN_OWNER_ID`, same as the GitHub secret).
2. Install: `make install-launcher`. This creates `~/.lockin/venv`, links `~/.local/bin/lockin`, writes `~/Library/LaunchAgents/com.adamkuhn.lockin.launcher.plist` and starts it.
3. Check: `~/.lockin/venv/bin/lockin doctor` → `OK: connected to Supabase, 0 queued launch requests`. Make sure `command -v lockin` finds it in a new Terminal window (add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` if not). The launcher's own prompts use the absolute path, so this only matters for "Copy prompt".
4. Grant permissions once: queue a Cold email from the app. macOS asks whether "python3.12" may control **Terminal** (Allow) and may ask for access to the **Desktop** folder (Allow; the resume folders live there). If you missed a prompt: System Settings → Privacy & Security → Automation / Files and Folders.
5. Status and logs: `make launcher-status`. Restart after pulling new code: `make install-launcher` again. Remove: `make uninstall-launcher`.

Behavior: the launcher polls every 10 s. A request is marked `launched` before Terminal opens, so it never opens twice; failures show in the app with the error. While the Mac is off, requests wait as "Queued for Mac".
```

- [ ] **Step 8: Commit**

```bash
git add worker/lockin_worker/install.py worker/tests/test_install.py Makefile scripts/keychain.sh docs/setup.md
git commit -m "Add launcher install: LaunchAgent plist, Makefile, Keychain helper"
```

- [ ] **Step 9: 👤 Install on Adam's Mac (batched setup session, needs Adam at the keyboard)**

Adam runs `make keychain` himself (secrets never pass through chat), then `make install-launcher` and `~/.lockin/venv/bin/lockin doctor`. Expected: `OK: connected to Supabase, …`. Then queue one outreach from the app (any real job URL) and confirm: Terminal opens within ~10 s running `claude`, the request turns `launched`, and after Claude finishes the outreach card shows contacts. If a permission prompt was denied, the card shows the osascript error; fix it in System Settings and tap Retry.

---

### Task 6: 👤 job-radar cutover (HUMAN-GATED — do not run any step without Adam's explicit OK in the batched setup session)

Spec §9: after the lock-in worker has run cleanly for 24 hours, disable job-radar's `radar.yml` and leave a README pointer. This task changes another repo and turns off Adam's current job alerts, so it waits for his go-ahead **at that step**, not just at the start of the session.

**Files:**
- Modify (in `~/Developer/job-radar`, a different repo): `README.md`
- Modify (this repo): `docs/setup.md` (append "job-radar cutover")

**Interfaces:**
- Consumes: the `sync` workflow from Plan 1 Task 10 running in `adamkuhn1/lock-in`.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Verify 24 h of clean sync runs**

Run:
```bash
gh run list -R adamkuhn1/lock-in --workflow sync --limit 100 --json conclusion,createdAt \
  --jq '[.[] | select(.createdAt > (now - 86400 | todate))] | {runs: length, failed: map(select(.conclusion != "success")) | length}'
```
Expected: `{"runs": N, "failed": 0}` with N ≥ 40 (two runs an hour, minus GitHub's delays). Also confirm in the app (or the Supabase table editor) that `sync_status` for `jobs` has `consecutive_failures = 0` and that new postings have arrived in the last 24 h. If `failed` > 0 or N < 40, stop and report; don't continue.

- [ ] **Step 2: 👤 Ask Adam, and wait for an explicit yes**

Say: "lock-in's sync has run clean for 24 hours (N runs, 0 failures). OK to disable job-radar's `radar.yml`? Its per-posting pushes stop; new postings show up in Lock In's Jobs tab and the daily nudges instead." Continue only on a clear yes.

- [ ] **Step 3: Disable the workflow**

```bash
gh workflow disable radar.yml -R adamkuhn1/job-radar
gh workflow list -R adamkuhn1/job-radar --all
```
Expected: the radar workflow is listed as `disabled_manually`.

- [ ] **Step 4: Add the README note in job-radar**

Check the identity first, without changing it: `git -C ~/Developer/job-radar config user.email` must print `184679495+adamkuhn1@users.noreply.github.com`. If it doesn't, stop and ask Adam; never run `git config`.

Insert directly under the `# job-radar` heading of `~/Developer/job-radar/README.md`:
```markdown
> **Retired (October 2026).** This code now runs inside [lock-in](https://github.com/adamkuhn1/lock-in) (`worker/job_radar/`), which stores postings in Supabase and summarizes them in its daily nudges. The `radar.yml` workflow here is disabled. To turn it back on: `gh workflow enable radar.yml -R adamkuhn1/job-radar`.
```
Then:
```bash
git -C ~/Developer/job-radar add README.md
git -C ~/Developer/job-radar commit -m "Point to lock-in; radar workflow disabled"
git -C ~/Developer/job-radar push
```

- [ ] **Step 5: Record it in this repo's `docs/setup.md`** (append)

```markdown
## job-radar cutover

Done on <date>, after <N> clean `sync` runs in 24 h. `radar.yml` in adamkuhn1/job-radar is disabled and its README points here.
Rollback: `gh workflow enable radar.yml -R adamkuhn1/job-radar`.
```
```bash
git add docs/setup.md
git commit -m "Record job-radar cutover"
```

---

## Self-Review Notes

- **Spec coverage:**
  - §3 `launcher/` + `cli/` → folded into `lockin_worker` (Tasks 2, 4); installed by `make install-launcher` instead of `pipx install -e` (Task 5). Auth via Keychain service key, not refresh token (controller ruling, Task 2).
  - §7 Suggest improvements prompt + `lockin save-ideas` → Tasks 1, 2, 4.
  - §8 resume match (one / several / none / iCloud) → Task 3; prompt content and guardrails → Task 1; Terminal launch → Task 4; `lockin save-outreach` → Task 2. "Several matches ask in Terminal" replaced by newest + listed others (ruling). Templates at repo-root `prompts/` (ruling), shared with Plan 2.
  - §8 Launcher: polling every 10 s only, no Realtime (ruling); mark `launched` then open; failures written back → Task 4.
  - §9 cutover → Task 6 (human-gated).
  - §12 launcher offline leaves requests queued → nothing to build; the web shows "Queued for Mac" (Plan 2).
  - §13 launcher/cli tests → every task. §14 step 5 → Task 5 Step 9.
- **Placeholder scan:** none; the only angle-bracket values are in human-run commands and docs (`<date>`, `<N>`, `<ref>`), filled in during the setup session.
- **Type consistency:** opener signature `(cwd, prompt, name)` is the same in `process`, `run_forever`, the test `Opener` and `terminal.open_in_terminal`. Placeholder names in Task 1 match `build_outreach`/`build_suggest` (Task 4) and Plan 2 Task 10. `find(root, company)` is the same in `resume.find_resume` and `fake_find`.
- **Spec clarifications in this plan:** the outreach company is stored only when it comes from the outreach row or a matching posting (never a URL slug); `save-outreach` replaces contacts on rerun and never moves `sent`/`replied` back to `drafted`; `save-ideas` skips ideas whose text matches an open idea; prompt files are kept 7 days in `~/Library/Caches/lockin/prompts`.
