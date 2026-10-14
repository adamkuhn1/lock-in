from pathlib import Path
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
