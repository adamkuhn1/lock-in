import io
import socket
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
    long = {**CONTACT, "draft_body": " ".join(["word"] * 111)}
    code, out, err = run(db_with_outreach(), ["save-outreach", "--id", OID], json.dumps({"contacts": [long]}))
    assert code == 0 and "111 words (aim for under 110)" in err
    ok = {**CONTACT, "draft_body": " ".join(["word"] * 110)}
    assert "words" not in run(db_with_outreach(), ["save-outreach", "--id", OID], json.dumps({"contacts": [ok]}))[2]


def test_save_ideas_appends_with_positions_and_skips_duplicates():
    db = db_with_outreach()
    db.insert("ideas", [{"id": "i0", "project_id": "27b", "text": "Add README screenshots", "status": "todo", "position": 4}])
    ideas = [{"text": "Add README screenshots", "size": "S"}, {"text": "Cache API calls", "size": "M"}, {"text": "Add a test"}]
    code, out, _ = run(db, ["save-ideas", "--project", "27b"], json.dumps(ideas))
    assert code == 0 and out.strip() == "Saved 2 ideas (1 duplicate skipped)"
    new = sorted((i for i in db.select("ideas") if i.get("id") != "i0"), key=lambda i: i["position"])
    assert [(i["text"], i["size"], i["position"], i["source"], i["status"]) for i in new] == [
        ("Cache API calls", "M", 5, "claude", "todo"), ("Add a test", "S", 6, "claude", "todo")]


def test_save_ideas_keeps_details_only_when_given():
    db = db_with_outreach()
    ideas = [{"text": "Make aiming easier", "details": "Ghost ball in drawAim", "size": "S"}, {"text": "Add a test"}]
    code, out, _ = run(db, ["save-ideas", "--project", "27b"], json.dumps(ideas))
    assert code == 0 and out.strip() == "Saved 2 ideas"
    rows = {i["text"]: i for i in db.select("ideas")}
    assert rows["Make aiming easier"]["details"] == "Ghost ball in drawAim"
    assert rows["Add a test"]["details"] is None
    code, _, err = run(db, ["save-ideas", "--project", "27b"], json.dumps([{"text": "x", "details": "d" * 1001}]))
    assert code == 2 and "$[0].details: longer than 1000 characters" in err


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


def test_save_outreach_sets_resume_path_when_given():
    db = db_with_outreach()
    body = {"company": "Stripe", "contacts": [CONTACT],
            "resume_path": "/Users/a/Desktop/Adam_Kuhn_Resumes/Stripe_SWE/Adam_Kuhn_Resume.pdf"}
    code, out, _ = run(db, ["save-outreach", "--id", OID], json.dumps(body))
    assert code == 0 and out.strip() == "Saved resume, 1 contact"
    assert db.select("outreach")[0]["resume_path"] == body["resume_path"]
    assert db.select("outreach")[0]["status"] == "drafted"


def test_save_outreach_without_resume_path_leaves_it_alone():
    db = db_with_outreach()
    db.update("outreach", {"id": OID}, {"resume_path": "/old/Adam_Kuhn_Resume.pdf"})
    run(db, ["save-outreach", "--id", OID], json.dumps({"contacts": [CONTACT]}))
    assert db.select("outreach")[0]["resume_path"] == "/old/Adam_Kuhn_Resume.pdf"


@pytest.mark.parametrize("bad,msg", [
    ("relative/Adam_Kuhn_Resume.pdf", "$.resume_path: must be an absolute path"),
    (42, "$.resume_path: must be a string"),
    ("/" + "a" * 500, "$.resume_path: longer than 500 characters"),
])
def test_save_outreach_rejects_bad_resume_path(bad, msg):
    db = db_with_outreach()
    code, _, err = run(db, ["save-outreach", "--id", OID], json.dumps({"contacts": [CONTACT], "resume_path": bad}))
    assert code == 2 and msg in err
    assert db.select("contacts") == []


RESUME = "/Users/a/Desktop/Adam_Kuhn_Resumes/Acme_SWE/Adam_Kuhn_Resume.pdf"


def test_save_outreach_resume_only_keeps_queued():
    db = db_with_outreach()
    code, out, _ = run(db, ["save-outreach", "--id", OID], json.dumps({"company": "Acme", "contacts": [], "resume_path": RESUME}))
    assert code == 0 and out.strip() == "Saved resume, 0 contacts"
    o = db.select("outreach")[0]
    assert (o["status"], o["resume_path"], o["company"]) == ("queued", RESUME, "Acme")
    assert db.select("contacts") == []


def test_save_outreach_resume_only_keeps_earlier_contacts():
    db = db_with_outreach(status="drafted")
    db.insert("contacts", [{**CONTACT, "id": "c0", "outreach_id": OID}])
    run(db, ["save-outreach", "--id", OID], json.dumps({"contacts": [], "resume_path": RESUME}))
    assert [c["id"] for c in db.select("contacts")] == ["c0"] and db.select("outreach")[0]["status"] == "drafted"


def test_empty_contacts_without_resume_path_is_still_an_error():
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID], json.dumps({"contacts": []}))
    assert code == 2 and "$.contacts: must be a non-empty list" in err
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID], json.dumps({"resume_path": RESUME}))
    assert code == 2 and "$.contacts" in err


@pytest.mark.parametrize("email", ["dana@stripe.com", "dana.reyes+jobs@eng.stripe.co.uk", "a_b-c@x.io"])
def test_email_guess_accepts_plain_addresses(email):
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID],
                       json.dumps({"contacts": [{**CONTACT, "email_guess": email}]}))
    assert code == 0, err


@pytest.mark.parametrize("email", ["dana@stripe", "dana stripe@x.com", "a@b@c.com", "a@b.com?bcc=e@v.il", "a@b.com,c@d.com",
                                   "a@b.com;c@d.com", "a&b@c.com", "a#b@c.com", "<a@b.com>", '"a"@b.com', "a'b@c.com",
                                   "@b.com", "a@.com", "a@b.c"])
def test_email_guess_rejects_anything_but_a_plain_address(email):
    code, _, err = run(db_with_outreach(), ["save-outreach", "--id", OID],
                       json.dumps({"contacts": [{**CONTACT, "email_guess": email}]}))
    assert code == 2 and "$.contacts[0].email_guess: not an email address" in err


def test_skip_job_closes_card_dismisses_posting_and_keeps_the_reason():
    db = db_with_outreach()
    db.insert("postings", [{"id": "p1", "url": "https://x/1", "status": "outreach"}, {"id": "p2", "url": "https://x/2", "status": "new"},
                           {"id": "p3", "url": "https://x/1", "status": "applied"}])
    db.insert("launch_requests", [{"id": "r1", "kind": "tailor_resume", "payload": {"outreach_id": OID}, "created_at": "2026-10-19T10:00:00Z"},
                                  {"id": "r0", "kind": "outreach", "payload": {"outreach_id": OID}, "created_at": "2026-10-18T10:00:00Z"}])
    code, out, _ = run(db, ["skip-job", "--id", OID, "--reason", "  PhD required\n(posting says PhD candidates only) "], "")
    assert code == 0 and out.strip() == "Skipped: card moved to Done, 1 posting dismissed"
    assert db.select("outreach", {"id": OID})[0]["status"] == "closed"
    assert {p["id"]: p["status"] for p in db.select("postings")} == {"p1": "dismissed", "p2": "new", "p3": "applied"}
    assert db.select("launch_requests", {"id": "r1"})[0]["payload"]["skipped"] == "PhD required (posting says PhD candidates only)"
    assert "skipped" not in db.select("launch_requests", {"id": "r0"})[0]["payload"]


def test_skip_job_refuses_emailed_cards_and_blank_reasons():
    db = db_with_outreach(status="sent")
    code, _, err = run(db, ["skip-job", "--id", OID, "--reason", "PhD"], "")
    assert code == 2 and "already emailed" in err and db.select("outreach", {"id": OID})[0]["status"] == "sent"
    code, _, err = run(db_with_outreach(), ["skip-job", "--id", OID, "--reason", "   "], "")
    assert code == 2 and "--reason is required" in err
    code, _, err = run(db_with_outreach(), ["skip-job", "--id", "nope", "--reason", "x"], "")
    assert code == 2 and "no outreach request" in err


# ---- save-picks (Find best fits) ----

def db_with_postings():
    db = MemoryDB()
    db.seed("postings", [
        {"id": "ramp|swe new grad|nyc", "company": "Ramp", "title": "SWE New Grad", "url": "https://jobs.ashbyhq.com/ramp/1", "status": "new"},
        {"id": "ibm|dev|austin", "company": "IBM", "title": "Dev", "url": "https://ibm.com/1", "status": "seen",
         "fit_rank": 1, "fit_reason": "old pick"},
        {"id": "stripe|swe|sf", "company": "Stripe", "title": "SWE", "url": "https://x/s", "status": "dismissed"},
    ])
    db.insert("applications", [{"company": "Notion", "role": "Software Engineer - Early Career"}])
    return db


def run_picks(db, picks, check=lambda url: ("ok", "")):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(["save-picks"], stdin=io.StringIO(json.dumps(picks)), stdout=out, stderr=err,
                    db_factory=lambda: db, link_check=check)
    return code, out.getvalue(), err.getvalue()


NEW_PICK = {"company": "Whatnot", "title": "Software Engineer - 2027 New Grad", "url": "https://jobs.ashbyhq.com/whatnot/9",
            "location": "Chicago, IL", "reason": "Marketplace backend; Chicago"}


def test_save_picks_ranks_inbox_and_new_and_replaces_old_list():
    db = db_with_postings()
    checked = []
    code, out, err = run_picks(db, [NEW_PICK, {"id": "ramp|swe new grad|nyc", "reason": "  NYC fintech\n new grad "}],
                               check=lambda url: checked.append(url) or ("ok", ""))
    assert code == 0, err
    assert out.strip() == "Saved 2 best fits (1 from the inbox, 1 new)"
    assert checked == [NEW_PICK["url"]]  # inbox links aren't re-checked
    rows = {p["id"]: p for p in db.select("postings")}
    assert rows["ramp|swe new grad|nyc"]["fit_rank"] == 2 and rows["ramp|swe new grad|nyc"]["fit_reason"] == "NYC fintech new grad"
    assert rows["ibm|dev|austin"]["fit_rank"] is None and rows["ibm|dev|austin"]["fit_reason"] is None
    new = rows["whatnot|software engineer 2027 new grad|chicago il"]
    assert new["fit_rank"] == 1 and new["found_by"] == "claude" and new["status"] == "new"
    assert new["starred"] is True  # Chicago is a preferred region in filters.yaml


def test_save_picks_dead_link_saves_nothing():
    db = db_with_postings()
    code, _, err = run_picks(db, [{"id": "ramp|swe new grad|nyc", "reason": "x"}, NEW_PICK],
                             check=lambda url: ("dead", "HTTP 404, the posting is gone"))
    assert code == 2 and "pick 2 (Whatnot · Software Engineer - 2027 New Grad)" in err and "Nothing was saved" in err
    assert db.select("postings", {"id": "ibm|dev|austin"})[0]["fit_rank"] == 1
    assert db.select("postings", {"id": "ramp|swe new grad|nyc"})[0].get("fit_rank") is None


def test_save_picks_unverified_link_saves_with_warning():
    code, out, err = run_picks(db_with_postings(), [NEW_PICK], check=lambda url: ("unverified", "HTTP 403 (the site blocks scripts)"))
    assert code == 0 and "Saved 1 best fit (0 from the inbox, 1 new)" in out and "couldn't check Whatnot" in err


def test_save_picks_skips_closed_applied_and_duplicate_picks():
    db = db_with_postings()
    picks = [{"id": "stripe|swe|sf", "reason": "x"},
             {"company": "Notion", "title": "Software Engineer - Early Career", "url": "https://jobs.ashbyhq.com/notion/1", "reason": "x"},
             {"id": "ramp|swe new grad|nyc", "reason": "x"},
             {"company": "Ramp", "title": "SWE New Grad", "url": "https://jobs.ashbyhq.com/ramp/1", "reason": "same url"}]
    code, out, err = run_picks(db, picks)
    assert code == 0 and "Saved 1 best fit (1 from the inbox, 0 new)" in out
    assert "Stripe · SWE: already dismissed" in err and "already in your applications" in err and "listed twice" in err
    assert db.select("postings", {"id": "ramp|swe new grad|nyc"})[0]["fit_rank"] == 1


@pytest.mark.parametrize("picks, msg", [
    ([], "non-empty JSON list"),
    ({"id": "x"}, "non-empty JSON list"),
    ([{"id": "x"}], "$[0].reason: required"),
    ([{"company": "A", "reason": "r"}], "$[0].title: required"),
    ([{**NEW_PICK, "url": "javascript:alert(1)"}], "plain http(s) link"),
    ([{**NEW_PICK, "url": "https://www.linkedin.com/jobs/view/1"}], "aggregator"),
    ([{"id": "nope", "reason": "r"}], "no posting with id 'nope'"),
    ([{"id": "x", "reason": "r"}] * 26, "at most 25"),
])
def test_save_picks_validation(picks, msg):
    code, _, err = run_picks(db_with_postings(), picks)
    assert code == 2 and msg in err


def test_check_link_classifies_responses():
    from lockin_worker import picks
    import urllib3

    def fetcher(*responses, exc=None):
        seen = []

        def fetch(url):
            seen.append(url)
            if exc:
                raise exc
            return responses[len(seen) - 1]
        return fetch, seen

    u = "https://boards.greenhouse.io/x/jobs/1"
    check = lambda *rs, exc=None: picks.check_link(u, fetcher(*rs, exc=exc)[0])[0]
    assert check((200, None)) == "ok"
    assert check((404, None)) == "dead"
    assert check((302, "/x?error=true"), (200, None)) == "dead"
    assert check((403, None)) == "unverified"
    assert check(exc=urllib3.exceptions.NewConnectionError(None, "refused")) == "dead"
    fetch, seen = fetcher((301, "https://job-boards.greenhouse.io/x/jobs/1"), (200, None))
    assert picks.check_link(u, fetch)[0] == "ok" and seen[-1] == "https://job-boards.greenhouse.io/x/jobs/1"


@pytest.mark.parametrize("url", [
    "https://evil.example:8080/x", "ftp://evil.example/x", "https://evil.example\\@127.0.0.1/x",
    "https://user@127.0.0.1/x", "https://evil.example/\x00", "http://evil.example/a b",
])
def test_check_link_refuses_odd_urls_before_fetching(url):
    from lockin_worker import picks

    def never(u):
        raise AssertionError(f"fetched {u}")
    assert picks.check_link(url, never) == ("dead", "isn't a public web address")


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0",
                                "64:ff9b::7f00:1", "64:ff9b:1::a00:1", "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:80ff:fffe",
                                "::127.0.0.1", "::ffff:10.0.0.1", "100.64.0.1"])
def test_check_link_connection_refuses_private_addresses(ip):
    """The real connection layer: the address is checked where urllib3 connects, so DNS can't swap it."""
    from lockin_worker import picks
    calls = []

    def resolve(host, port, **kw):
        calls.append(host)
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]
    assert picks.check_link("https://jobs.example.com/1", resolve=resolve) == ("dead", "isn't a public web address")
    assert calls == ["jobs.example.com"]  # resolved once, at connect time


def test_check_link_redirect_to_a_private_address_is_refused():
    """A public posting that redirects into the LAN: the next hop goes through the same pinned connection."""
    from lockin_worker import picks
    real = picks._pool_manager

    def resolve(host, port, **kw):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.1", port))]

    class FirstHopPublic:
        def __init__(self):
            self.pm = real(resolve)
            self.n = 0

        def request(self, method, url, **kw):
            self.n += 1
            if self.n == 1:  # pretend the public posting answered with a redirect into the LAN
                class R:
                    status, headers = 302, {"Location": "http://router.lan/admin"}
                    def close(self):
                        pass
                return R()
            return self.pm.request(method, url, **kw)

    import pytest as _pt
    mp = _pt.MonkeyPatch()
    mp.setattr(picks, "_pool_manager", lambda r: FirstHopPublic())
    try:
        assert picks.check_link("https://jobs.example.com/1", resolve=resolve) == ("dead", "isn't a public web address")
    finally:
        mp.undo()


def test_public_addresses_still_allowed():
    from lockin_worker import picks
    for ip in ("93.184.216.34", "2606:4700::6810:84e5", "::ffff:93.184.216.34"):
        assert picks._is_public(ip), ip
