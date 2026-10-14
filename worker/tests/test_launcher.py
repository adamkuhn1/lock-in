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
