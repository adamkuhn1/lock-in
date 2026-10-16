from pathlib import Path
import errno
import shutil

import pytest
from lockin_worker import launcher
from lockin_worker.db import MemoryDB, DBError
from lockin_worker.resume import ResumeChoice

OID = "o-1"


@pytest.fixture(autouse=True)
def outreach_dir(tmp_path, monkeypatch):
    d = tmp_path / "home" / ".lockin" / "outreach"
    monkeypatch.setattr(launcher, "OUTREACH_DIR", d)
    return d


class Opener:
    def __init__(self, fail: Exception | None = None, db=None):
        self.calls, self.fail, self.db, self.status_at_open = [], fail, db, None

    def __call__(self, cwd, prompt, name):
        if self.db is not None:
            self.status_at_open = self.db.select("launch_requests", {"id": name})[0]["status"]
        self.calls.append((cwd, prompt, name))
        if self.fail:
            raise self.fail


def fake_find(root, company, role=None):
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


def test_outreach_prompt_and_outreach_row(tmp_path, outreach_dir):
    db = db_fixture(tmp_path)
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin", find=fake_find)
    cwd, prompt, _ = op.calls[0]
    assert cwd == outreach_dir and outreach_dir.is_dir()
    assert (outreach_dir.stat().st_mode & 0o777) == 0o700
    assert "/v/bin/lockin save-outreach --id o-1 <<'JSON'" in prompt
    assert "Resume to use: /R/Stripe_SWE/Adam_Kuhn_Resume.pdf" in prompt and "Matched for Stripe." in prompt
    assert "{{" not in prompt
    o = db.select("outreach", {"id": OID})[0]
    assert o["resume_path"] == "/R/Stripe_SWE/Adam_Kuhn_Resume.pdf" and o["company"] == "Stripe"


def test_outreach_without_posting_uses_url_company_but_does_not_store_slug(tmp_path):
    db = db_fixture(tmp_path)
    db.delete("postings")
    seen = []
    launcher.poll_once(db, Opener(), "lockin", find=lambda root, c, role=None: (seen.append(c), fake_find(root, c))[1])
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


def test_default_outreach_dir_is_dedicated_not_home():
    assert launcher.DEFAULT_OUTREACH_DIR == Path.home() / ".lockin" / "outreach"


def test_lockin_path_with_spaces_is_shell_quoted(tmp_path):
    db = db_fixture(tmp_path)
    op = Opener()
    launcher.poll_once(db, op, "/Users/a b/venv/bin/lockin", find=fake_find)
    assert "'/Users/a b/venv/bin/lockin' save-outreach --id o-1 <<'JSON'" in op.calls[0][1]
    assert "'/Users/a b/venv/bin/lockin' save-ideas --project 27b" in op.calls[1][1]

@pytest.fixture(autouse=True)
def mock_dir(tmp_path, monkeypatch):
    d = tmp_path / "home" / ".lockin" / "mock"
    monkeypatch.setattr(launcher, "MOCK_DIR", d)
    return d


def work_db(tmp_path, local_path="exists", readme=True):
    db = MemoryDB()
    proj = tmp_path / "27b"
    proj.mkdir(exist_ok=True)
    if readme:
        (proj / "README.md").write_text("\n".join(f"line {i}" for i in range(1, 80)))
    path = str(proj) if local_path == "exists" else local_path
    db.insert("projects", [{"id": "27b", "name": "27B", "repo": "adamkuhn1/27b", "local_path": path, "active": True}])
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "Add Chicago to the city picker!", "size": "S",
                         "status": "in_progress", "started_at": "2026-10-14T12:00:00Z"}])
    db.insert("launch_requests", [{"id": "w1", "kind": "work_on_idea", "payload": {"idea_id": "i1", "prev_status": "today"},
                                   "status": "queued", "created_at": "2026-10-14T12:00:00Z"}])
    return db, proj


def test_slugify():
    assert launcher.slugify("Add Chicago to the city picker!") == "add-chicago-to-the-city-picker"
    assert launcher.slugify("!!!") == "idea"
    assert len(launcher.slugify("x" * 100)) <= 40


def test_work_on_idea_opens_in_project_with_prompt(tmp_path):
    db, proj = work_db(tmp_path)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("w1", "launched")]
    cwd, prompt, name = op.calls[0]
    assert cwd == proj and name == "w1"
    assert "Add Chicago to the city picker!" in prompt and "idea/add-chicago-to-the-city-picker" in prompt
    assert "line 60" in prompt and "line 61" not in prompt
    assert db.select("ideas", {"id": "i1"})[0]["status"] == "in_progress"


def test_work_on_idea_passes_technical_details(tmp_path):
    db, _ = work_db(tmp_path)
    db.update("ideas", {"id": "i1"}, {"details": "Add 'Chicago' to CITIES in src/cities.ts"})
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin")
    assert "Add 'Chicago' to CITIES in src/cities.ts" in op.calls[0][1]


def test_work_on_idea_without_details_says_so(tmp_path):
    db, _ = work_db(tmp_path)
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin")
    assert "None beyond the title above." in op.calls[0][1]


def test_work_on_idea_without_readme(tmp_path):
    db, _ = work_db(tmp_path, readme=False)
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin")
    assert "No README." in op.calls[0][1]


@pytest.mark.parametrize("path", [None, "/nope/does-not-exist"])
def test_work_on_idea_missing_folder_fails_and_reverts(tmp_path, path):
    db, _ = work_db(tmp_path, local_path=path)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("w1", "failed")]
    assert op.calls == []
    assert "Project folder not found" in status(db, "w1")["error"]
    i = db.select("ideas", {"id": "i1"})[0]
    assert i["status"] == "today" and i["started_at"] is None


def test_work_on_idea_reverts_when_terminal_fails(tmp_path):
    db, _ = work_db(tmp_path)
    op = Opener(fail=RuntimeError("osascript failed"))
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("w1", "failed")]
    assert db.select("ideas", {"id": "i1"})[0]["status"] == "today"


def test_mock_interview_renders_stories_and_notes(tmp_path, mock_dir):
    db = MemoryDB()
    db.insert("stories", [{"id": "s1", "title": "Shipped 27B", "tags": ["impact"], "situation": "Class project",
                           "task": "Lead", "action": "Built it", "result": "200 users", "created_at": "2026-10-01"}])
    db.insert("company_prep", [{"company": "Stripe", "notes": "Bug bash round"}])
    db.insert("launch_requests", [{"id": "m1", "kind": "mock_interview", "payload": {"mode": "behavioral", "company": "stripe"},
                                   "status": "queued", "created_at": "2026-10-14T12:00:00Z"}])
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("m1", "launched")]
    cwd, prompt, _ = op.calls[0]
    assert cwd == mock_dir and oct(mock_dir.stat().st_mode & 0o777) == "0o700"
    assert "### Shipped 27B (impact)" in prompt and "- Result: 200 users" in prompt
    assert "Bug bash round" in prompt and "behavioral" in prompt
    assert "/v/bin/lockin log-prep --kind mock" in prompt


def test_mock_interview_rejects_unknown_mode(tmp_path):
    db = MemoryDB()
    db.insert("launch_requests", [{"id": "m2", "kind": "mock_interview", "payload": {"mode": "chess"},
                                   "status": "queued", "created_at": "2026-10-14T12:00:00Z"}])
    assert launcher.poll_once(db, Opener(), "/v/bin/lockin") == [("m2", "failed")]


def test_format_stories_empty():
    assert launcher.format_stories([]) == "No stories saved yet."


@pytest.mark.parametrize("now_status", ["done", "todo", "today"])
def test_work_on_idea_no_longer_in_progress_fails_without_touching_it(tmp_path, now_status):
    # M1: Adam ticked it done (or undid it) before the Mac picked the request up.
    db, _ = work_db(tmp_path)
    db.update("ideas", {"id": "i1"}, {"status": now_status})
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("w1", "failed")]
    assert op.calls == []
    assert "Idea is no longer in progress" in status(db, "w1")["error"]
    i = db.select("ideas", {"id": "i1"})[0]
    assert i["status"] == now_status and i["started_at"] == "2026-10-14T12:00:00Z"


def test_revert_work_only_reverts_an_in_progress_idea(tmp_path):
    db, _ = work_db(tmp_path)
    db.update("ideas", {"id": "i1"}, {"status": "done"})
    launcher.revert_work(db, {"idea_id": "i1", "prev_status": "today"})
    assert db.select("ideas", {"id": "i1"})[0]["status"] == "done"
    db.update("ideas", {"id": "i1"}, {"status": "in_progress"})
    launcher.revert_work(db, {"idea_id": "i1", "prev_status": "today"})
    i = db.select("ideas", {"id": "i1"})[0]
    assert i["status"] == "today" and i["started_at"] is None


def test_work_prompt_fences_readme_so_backticks_cannot_break_it(tmp_path):
    db, proj = work_db(tmp_path)
    (proj / "README.md").write_text("# 27B\n```bash\nnpm i\n```\nafter")
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin")
    prompt = op.calls[0][1]
    assert "~~~~\n# 27B\n```bash\nnpm i\n```\nafter\n~~~~" in prompt


# --- tailor_resume -------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def tailor_dir(tmp_path, monkeypatch):
    d = tmp_path / "home" / ".lockin" / "tailor"
    monkeypatch.setattr(launcher, "TAILOR_DIR", d)
    return d


@pytest.fixture(autouse=True)
def icloud(monkeypatch):
    calls = []
    monkeypatch.setattr(launcher, "ICLOUD_RUN", lambda *a, **k: calls.append(a[0]))
    monkeypatch.setattr(launcher, "ICLOUD_SLEEP", lambda s: None)
    return calls


def tailor_db(tmp_path, base=True, company=None, role=None, job_url="https://boards.greenhouse.io/stripe/jobs/1"):
    root = tmp_path / "Resumes"
    if base:
        (root / "Base_Resume").mkdir(parents=True)
        (root / "Base_Resume" / "Adam_Kuhn_Resume.tex").write_text("\\documentclass{article} base")
        (root / "Base_Resume" / "Adam_Kuhn_Resume.pdf").write_bytes(b"%PDF-1.4")
    db = MemoryDB()
    db.insert("settings", [{"resume_root": str(root)}])
    db.insert("outreach", [{"id": "t-1", "job_url": job_url, "status": "queued", "company": company, "role": role}])
    db.insert("postings", [{"id": "p1", "url": "https://boards.greenhouse.io/stripe/jobs/1", "company": "Stripe",
                            "title": "Software Engineer, New Grad (2027)"}])
    db.insert("launch_requests", [{"id": "tr1", "kind": "tailor_resume",
                                   "payload": {"outreach_id": "t-1", "job_url": job_url},
                                   "status": "queued", "created_at": "2026-10-14T12:00:00Z"}])
    return db, root


def test_tailor_resume_happy_path(tmp_path, tailor_dir):
    db, root = tailor_db(tmp_path)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "launched")]
    cwd, prompt, name = op.calls[0]
    assert name == "tr1"
    assert cwd.parent == tailor_dir and cwd.is_dir()
    assert (tailor_dir.stat().st_mode & 0o777) == 0o700 and (cwd.stat().st_mode & 0o777) == 0o700
    assert (cwd / "Adam_Kuhn_Resume.tex").read_text() == "\\documentclass{article} base"
    assert str(root / "Base_Resume" / "Adam_Kuhn_Resume.tex") in prompt
    assert str(root / "Base_Resume" / "Adam_Kuhn_Resume.pdf") in prompt
    assert str(root) in prompt and str(cwd) in prompt
    assert "Stripe_Software_Engineer_New_Grad_2027" in prompt
    assert "`open https://boards.greenhouse.io/stripe/jobs/1`" in prompt
    assert "/v/bin/lockin save-outreach --id t-1 <<'JSON'" in prompt
    assert "I just applied to Browserbase's" in prompt and "I just applied to Valon's" in prompt
    o = db.select("outreach", {"id": "t-1"})[0]
    assert (o["company"], o["role"]) == ("Stripe", "Software Engineer, New Grad (2027)")


def test_tailor_resume_expands_home_in_resume_root(tmp_path, monkeypatch):
    db, root = tailor_db(tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    db.update("settings", {}, {"resume_root": "~/Resumes"})
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "launched")]
    assert str(root / "Base_Resume" / "Adam_Kuhn_Resume.tex") in op.calls[0][1]


def test_tailor_resume_missing_base_fails_with_message(tmp_path, icloud):
    db, root = tailor_db(tmp_path, base=False)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "failed")]
    assert op.calls == []
    err = status(db, "tr1")["error"]
    assert f"Base resume not found at {root / 'Base_Resume' / 'Adam_Kuhn_Resume.tex'}" in err
    assert "(check the file exists and Terminal/Python has Desktop access)" in err


def test_tailor_resume_unknown_outreach_fails(tmp_path):
    db, _ = tailor_db(tmp_path)
    db.update("launch_requests", {"id": "tr1"}, {"payload": {"outreach_id": "nope"}})
    assert launcher.poll_once(db, Opener(), "/v/bin/lockin") == [("tr1", "failed")]
    assert "outreach 'nope' not found" in status(db, "tr1")["error"]


def test_tailor_resume_uses_outreach_company_and_role_over_posting(tmp_path):
    db, _ = tailor_db(tmp_path, company="Roblox", role="Software Engineer - Early Career 2027",
                      job_url="https://careers.roblox.com/jobs/9")
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin")
    assert "Roblox_Software_Engineer_Early_Career_2027" in op.calls[0][1]


@pytest.mark.parametrize("company,role,expected", [
    ("Valon", "Software Engineer, New Grad", "Valon_Software_Engineer_New_Grad"),
    ("Roblox", "Software Engineer - Early Career (2027)", "Roblox_Software_Engineer_Early_Career_2027"),
    ("AT&T  Inc.", "SWE / Intern -- Summer", "AT_T_Inc_SWE_Intern_Summer"),
    ("Café Co", None, "Caf_Co"),
    ("", "", "Tailored_Resume"),
    ("A" * 60, "B" * 60, ("A" * 60 + "_" + "B" * 60)[:80]),
])
def test_folder_hint_sanitizing(company, role, expected):
    hint = launcher.folder_hint(company, role)
    assert hint == expected
    assert len(hint) <= 80 and not hint.endswith("_") and "__" not in hint


def test_folder_hint_trims_trailing_underscore_after_cut():
    assert launcher.folder_hint("A" * 79, "B") == "A" * 79


def test_tailor_work_dirs_differ_per_outreach(tmp_path):
    db, _ = tailor_db(tmp_path)
    db.insert("outreach", [{"id": "t-2", "job_url": "https://boards.greenhouse.io/stripe/jobs/1", "status": "queued"}])
    db.insert("launch_requests", [{"id": "tr2", "kind": "tailor_resume", "payload": {"outreach_id": "t-2"},
                                   "status": "queued", "created_at": "2026-10-14T12:01:00Z"}])
    op = Opener()
    launcher.poll_once(db, op, "/v/bin/lockin")
    assert op.calls[0][0] != op.calls[1][0]


def test_default_tailor_dir_is_dedicated():
    assert launcher.DEFAULT_TAILOR_DIR == Path.home() / ".lockin" / "tailor"


@pytest.mark.parametrize("bad", [
    'https://x.com/a";rm -rf ~;"',
    "https://x.com/$(whoami)",
    "https://x.com/`id`",
    "https://x.com/a'b",
    "https://x.com/a b",
    "https://x.com/a\nb",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https:///no-host",
    "",
    "https://x.com/" + "a" * 2000,
])
def test_tailor_resume_rejects_unsafe_job_url(tmp_path, tailor_dir, bad):
    db, _ = tailor_db(tmp_path, job_url=bad)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "failed")]
    assert op.calls == []
    assert "Job link isn't a plain http(s) URL" in status(db, "tr1")["error"]
    assert not tailor_dir.exists()  # nothing created for a rejected link


def test_tailor_resume_shell_quotes_job_url_with_query(tmp_path):
    url = "https://boards.greenhouse.io/x/jobs/1?gh_src=abc&t=1"
    db, _ = tailor_db(tmp_path, job_url=url)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "launched")]
    prompt = op.calls[0][1]
    assert "open 'https://boards.greenhouse.io/x/jobs/1?gh_src=abc&t=1'" in prompt
    assert f"- Posting: {url}" in prompt


def test_safe_job_url_accepts_plain_links():
    assert launcher.safe_job_url("http://example.com/jobs/1#apply") == "http://example.com/jobs/1#apply"
    with pytest.raises(launcher.LaunchError, match="Job link isn't a plain http\\(s\\) URL"):
        launcher.safe_job_url(None)


# --- tailor_resume: iCloud-evicted base resume ---------------------------------------------

def test_tailor_resume_retries_copy_after_edeadlk(tmp_path, monkeypatch, icloud):
    db, root = tailor_db(tmp_path)
    real, state = shutil.copyfile, {"n": 0}

    def flaky(src, dst):
        state["n"] += 1
        if state["n"] == 1:
            raise OSError(errno.EDEADLK, "Resource deadlock avoided")
        return real(src, dst)

    ensured = []
    orig = launcher.resume.ensure_local
    monkeypatch.setattr(launcher.shutil, "copyfile", flaky)
    monkeypatch.setattr(launcher.resume, "ensure_local", lambda p, *a, **k: ensured.append(p) or orig(p, *a, **k))
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "launched")]
    tex = root / "Base_Resume" / "Adam_Kuhn_Resume.tex"
    assert state["n"] == 2 and ensured.count(tex) == 2  # initial download + retry


def test_copy_base_edeadlk_retry_forces_download(tmp_path, monkeypatch, icloud):
    src, dst = tmp_path / "base.pdf", tmp_path / "out.pdf"
    src.write_bytes(b"%PDF")
    real, state = shutil.copyfile, {"n": 0}

    def flaky(s, d):
        state["n"] += 1
        if state["n"] == 1:
            raise OSError(errno.EDEADLK, "Resource deadlock avoided")
        return real(s, d)

    monkeypatch.setattr(launcher.shutil, "copyfile", flaky)
    launcher._copy_base(src, dst)
    assert state["n"] == 2 and dst.read_bytes() == b"%PDF"
    assert ["brctl", "download", str(src)] in icloud  # file exists locally, so only force triggers this


def test_tailor_resume_persistent_edeadlk_fails_with_icloud_message(tmp_path, monkeypatch, icloud):
    db, _ = tailor_db(tmp_path)
    n = {"n": 0}

    def always(src, dst):
        n["n"] += 1
        raise OSError(errno.EDEADLK, "Resource deadlock avoided")

    monkeypatch.setattr(launcher.shutil, "copyfile", always)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "failed")]
    assert op.calls == [] and n["n"] == launcher.COPY_ATTEMPTS
    assert "Base resume is in iCloud and couldn't be downloaded" in status(db, "tr1")["error"]


def test_tailor_resume_icloud_placeholder_downloads_then_launches(tmp_path, monkeypatch):
    db, root = tailor_db(tmp_path)
    base = root / "Base_Resume"
    (base / "Adam_Kuhn_Resume.tex").rename(base / ".Adam_Kuhn_Resume.tex.icloud")
    brctl = []

    def fake_run(cmd, **kw):
        brctl.append(cmd)
        (base / ".Adam_Kuhn_Resume.tex.icloud").rename(base / "Adam_Kuhn_Resume.tex")

    monkeypatch.setattr(launcher, "ICLOUD_RUN", fake_run)
    monkeypatch.setattr(launcher, "ICLOUD_SLEEP", lambda s: None)
    op = Opener()
    assert launcher.poll_once(db, op, "/v/bin/lockin") == [("tr1", "launched")]
    assert brctl == [["brctl", "download", str(base / "Adam_Kuhn_Resume.tex")]]


def test_tailor_resume_placeholder_that_never_downloads_gets_icloud_message(tmp_path, monkeypatch, icloud):
    db, root = tailor_db(tmp_path)
    base = root / "Base_Resume"
    (base / "Adam_Kuhn_Resume.pdf").rename(base / ".Adam_Kuhn_Resume.pdf.icloud")
    monkeypatch.setattr(launcher.resume, "ensure_local", lambda *a, **k: False)
    assert launcher.poll_once(db, Opener(), "/v/bin/lockin") == [("tr1", "failed")]
    assert "in iCloud and couldn't be downloaded" in status(db, "tr1")["error"]
