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
    for n, row in enumerate(db.tables["contacts"]):
        row["id"] = f"c{n}"  # real rows carry server-generated ids
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
    new = sorted((i for i in db.select("ideas") if i.get("id") != "i0"), key=lambda i: i["position"])
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
    db.key, db.owner = "SECRET-SERVICE-KEY", "SECRET-OWNER-ID"
    code, out, err = run(db, ["doctor"], "")
    assert code == 0 and "connected" in out and "1 queued launch request" in out
    assert "SECRET-SERVICE-KEY" not in out + err and "SECRET-OWNER-ID" not in out + err


def test_failed_insert_keeps_old_contacts():
    class FailInsert(MemoryDB):
        def insert(self, table, rows):
            if table == "contacts" and getattr(self, "armed", False):
                raise DBError("POST contacts: HTTP 500")
            super().insert(table, rows)
    db = FailInsert()
    db.insert("outreach", [{"id": OID, "status": "queued", "company": None, "role": None}])
    db.insert("contacts", [{"id": "c1", "outreach_id": OID, "name": "Old One"}])
    db.armed = True
    code, _, err = run(db, ["save-outreach", "--id", OID], json.dumps({"contacts": [CONTACT]}))
    assert code == 1 and "HTTP 500" in err
    assert [c["name"] for c in db.select("contacts")] == ["Old One"]


def test_replace_deletes_only_old_ids():
    db = db_with_outreach()
    db.insert("contacts", [{"id": "c1", "outreach_id": OID, "name": "Old"}])
    run(db, ["save-outreach", "--id", OID], json.dumps({"contacts": [CONTACT]}))
    assert [c["name"] for c in db.select("contacts")] == ["Dana Reyes"]


@pytest.mark.parametrize("exc", [OSError("no such file: security"), __import__("requests").ConnectionError("offline")])
def test_network_and_os_errors_exit_1(exc):
    def boom():
        raise exc
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(["doctor"], stdin=io.StringIO(""), stdout=out, stderr=err, db_factory=boom)
    assert code == 1 and f"error: {type(exc).__name__}:" in err.getvalue()


from lockin_worker import clock


def test_log_prep_inserts_a_session_on_todays_plan_day(monkeypatch):
    from datetime import datetime, timezone
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 14, 6, 0, tzinfo=timezone.utc))  # 02:00 EDT -> Oct 13
    db = MemoryDB()
    code, out, _ = run(db, ["log-prep", "--kind", "mock", "--minutes", "30", "--note", "  STAR felt rushed  "], "")
    assert code == 0 and out.strip() == "Logged mock session"
    row = db.select("prep_sessions")[0]
    assert row == {"kind": "mock", "minutes": 30, "note": "STAR felt rushed", "company": None, "happened_on": "2026-10-13"}


@pytest.mark.parametrize("argv", [
    ["log-prep", "--kind", "mock", "--minutes", "0"],
    ["log-prep", "--kind", "mock", "--minutes", "601"],
])
def test_log_prep_rejects_bad_minutes(argv):
    db = MemoryDB()
    code, _, err = run(db, argv, "")
    assert code == 2 and "minutes" in err and db.select("prep_sessions") == []


def test_log_prep_rejects_unknown_kind():
    db = MemoryDB()
    with pytest.raises(SystemExit) as e:
        cli.main(["log-prep", "--kind", "nap"], db_factory=lambda: db)
    assert e.value.code == 2 and db.select("prep_sessions") == []
