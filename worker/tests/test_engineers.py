"""Find engineers: launcher prompt, lockin save-engineers, lockin skip-job --request."""
import io
import json

import pytest

from lockin_worker import cli, launcher, prompts
from lockin_worker.db import MemoryDB

RID = "22222222-2222-2222-2222-222222222222"
NOTE = ("Hi Maya, I was a SWE intern at Apple this summer and saw you moved from Apple to Stripe. I just applied to "
        "the Software Engineer, New Grad role. Would you be open to referring me? Thanks! Adam")
ENG = {"name": "Maya Chen", "title": "Software Engineer", "profile_url": "https://www.linkedin.com/in/maya-chen",
       "pick": "ex_apple", "why": "Snippet: Software Engineer at Stripe · Previously Apple", "note": NOTE}


def db_with_request(payload=None):
    db = MemoryDB()
    db.insert("launch_requests", [{"id": RID, "kind": "find_engineers", "status": "launched", "created_at": "2026-10-28T10:00:00Z",
                                   "payload": payload or {"posting_id": "p1", "job_url": "https://boards.greenhouse.io/stripe/jobs/1",
                                                          "company": "Stripe", "role": "Software Engineer, New Grad", "tier": "reach"}}])
    db.insert("postings", [{"id": "p1", "company": "Stripe", "title": "Software Engineer, New Grad", "status": "new",
                            "url": "https://boards.greenhouse.io/stripe/jobs/1", "tier": "reach", "location": "NYC"}])
    return db


def run(db, argv, stdin_text=""):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(argv, stdin=io.StringIO(stdin_text), stdout=out, stderr=err, db_factory=lambda: db)
    return code, out.getvalue(), err.getvalue()


def save(db, engineers, **top):
    return run(db, ["save-engineers", "--request", RID], json.dumps({"company": "Stripe", "role": "SWE", "engineers": engineers, **top}))


def test_save_engineers_copies_the_job_from_the_request():
    db = db_with_request()
    code, out, err = save(db, [ENG, {**ENG, "name": "Sam Lee", "pick": "cmu", "profile_url": "https://linkedin.com/in/samlee/"}])
    assert code == 0 and out.strip() == "Saved 2 engineers" and err == ""
    rows = db.select("referrals")
    assert [(r["name"], r["pick"], r["status"]) for r in rows] == [("Maya Chen", "ex_apple", "drafted"), ("Sam Lee", "cmu", "drafted")]
    assert all((r["company"], r["role"], r["tier"], r["posting_id"], r["request_id"]) ==
               ("Stripe", "Software Engineer, New Grad", "reach", "p1", RID) for r in rows)


def test_save_again_replaces_this_runs_drafts_but_keeps_sent_notes():
    db = db_with_request()
    save(db, [ENG])
    db.update("referrals", {"name": "Maya Chen"}, {"status": "sent"})
    code, out, err = save(db, [ENG, {**ENG, "name": "Ava Park", "profile_url": "https://www.linkedin.com/in/ava"}])
    assert code == 0 and out.strip() == "Saved 1 engineer" and "skipped Maya Chen" in err
    assert sorted(r["name"] for r in db.select("referrals")) == ["Ava Park", "Maya Chen"]
    code, out, _ = save(db, [{**ENG, "name": "Lee Kim", "profile_url": "https://www.linkedin.com/in/lee"}])
    assert sorted(r["name"] for r in db.select("referrals")) == ["Lee Kim", "Maya Chen"]  # Ava's draft replaced


@pytest.mark.parametrize("bad, msg", [
    ({**ENG, "note": "x" * 281}, "281 characters"),
    ({**ENG, "profile_url": "https://example.com/maya"}, "linkedin.com/in"),
    ({**ENG, "pick": "friend"}, "pick: must be one of"),
    ({**ENG, "note": None}, "note: required"),
])
def test_save_engineers_rejects_bad_rows(bad, msg):
    db = db_with_request()
    code, _, err = save(db, [bad])
    assert code == 2 and msg in err and db.select("referrals") == []


def test_save_engineers_at_most_two():
    code, _, err = save(db_with_request(), [ENG, ENG, ENG])
    assert code == 2 and "at most 2" in err


def test_save_engineers_warns_when_the_note_skips_apple_or_the_role():
    db = db_with_request()
    code, _, err = run(db, ["save-engineers", "--request", RID],
                       json.dumps({"company": "Stripe", "role": "Payments Backend Engineer", "engineers": [{**ENG, "note": "Hi Maya, can we chat?"}]}))
    assert code == 0 and "Apple internship" in err


def test_save_engineers_needs_a_find_engineers_request():
    db = MemoryDB()
    code, _, err = save(db, [ENG])
    assert code == 2 and "no Find engineers request" in err


def test_skip_job_request_dismisses_the_posting_and_keeps_the_reason():
    db = db_with_request()
    code, out, _ = run(db, ["skip-job", "--request", RID, "--reason", "PhD required"])
    assert code == 0 and out.strip() == "Skipped: 1 posting dismissed"
    assert db.select("postings")[0]["status"] == "dismissed"
    assert db.select("launch_requests")[0]["payload"]["skipped"] == "PhD required"


def test_skip_job_needs_exactly_one_target():
    db = db_with_request()
    with pytest.raises(SystemExit):
        run(db, ["skip-job", "--reason", "x"])


def test_template_placeholders():
    assert prompts.placeholders(prompts.load("find_engineers")) == {
        "company", "role", "tier", "job_url", "who", "already", "fit_step", "lockin", "request_id"}


def test_build_engineers_prompt(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "ENGINEERS_DIR", tmp_path / "eng")
    db = db_with_request()
    db.insert("referrals", [{"id": "r0", "company": "Stripe, Inc.", "name": "Old Contact", "title": "SWE", "status": "sent", "role": "Intern"}])
    cwd, text = launcher.build_engineers(db, {**db.select("launch_requests")[0]["payload"], "request_id": RID}, "/bin/lockin")
    assert cwd == tmp_path / "eng"
    for needle in ["Company: Stripe", "Role: Software Engineer, New Grad", "Tier: reach", "Ex-Apple", "Central Michigan University alumni",
                   "under 280 characters", "Do NOT open or fetch linkedin.com pages", "/bin/lockin save-engineers --request " + RID,
                   "/bin/lockin skip-job --request " + RID, "- Old Contact (SWE): note sent, Intern", "May 2027", "December 2027"]:
        assert needle in text, needle


def test_build_engineers_from_an_application_has_no_fit_check(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "ENGINEERS_DIR", tmp_path / "eng")
    db = MemoryDB()
    _, text = launcher.build_engineers(db, {"company": "Figma", "role": "SWE New Grad", "tier": "reach", "request_id": RID}, "lockin")
    assert "Skip the fit check" in text and "skip-job --request" not in text and "- Nobody yet." in text


def test_build_engineers_needs_a_company(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "ENGINEERS_DIR", tmp_path / "eng")
    with pytest.raises(launcher.LaunchError, match="No company"):
        launcher.build_engineers(MemoryDB(), {"request_id": RID}, "lockin")


def test_process_hands_the_request_id_to_the_builder(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "ENGINEERS_DIR", tmp_path / "eng")
    db = db_with_request()
    db.update("launch_requests", {"id": RID}, {"status": "queued"})
    opened = []
    launcher.process(db, db.select("launch_requests")[0], lambda cwd, text, rid, **kw: opened.append(text), "lockin")
    assert f"save-engineers --request {RID}" in opened[0]
