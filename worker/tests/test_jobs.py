import re
from datetime import datetime
from pathlib import Path
from job_radar.config import Company, Filters, LocationRules
from job_radar.models import FetchError, Job
from job_radar.radar import build_sources
from lockin_worker import jobs
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

NOW = datetime(2026, 10, 14, 12, tzinfo=TZ)
FILTERS = Filters(include=re.compile("intern|new grad", re.I), exclude=re.compile("senior", re.I),
                  location=LocationRules())

def J(i, title="Software Engineer Intern", company="Stripe"):
    return Job(company, title, "New York, NY", f"https://x/{i}", None, str(i))

def sources():
    return build_sources([Company("Stripe", "greenhouse", "stripe", "reach"), Company("Ramp", "ashby", "ramp", "reach")], [])

def fake(board):
    def fetch(src, session, prev_sha):
        v = board[src.key]
        if isinstance(v, Exception):
            raise v
        return v, None
    return fetch

def test_first_run_seeds_silently():
    db = MemoryDB()
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake({"greenhouse:stripe": [J(1)], "ashby:ramp": []}))
    assert out["new"] == 0 and db.select("postings") == []

def test_second_run_inserts_matching_new_only():
    db = MemoryDB()
    board = {"greenhouse:stripe": [J(1)], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board["greenhouse:stripe"] = [J(1), J(2), J(3, title="Senior Engineer Intern")]
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    rows = db.select("postings")
    assert out["new"] == 1 and [r["title"] for r in rows] == ["Software Engineer Intern"]
    assert rows[0]["status"] == "new" and rows[0]["tier"] == "reach"

def test_same_posting_two_sources_once():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board = {"greenhouse:stripe": [J(5)], "ashby:ramp": [J(9, company="Stripe")]}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert len(db.select("postings")) == 1

def test_source_error_reported_others_continue():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board = {"greenhouse:stripe": FetchError("HTTP 404"), "ashby:ramp": [J(7, company="Ramp")]}
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert out["errors"] == {"greenhouse:stripe": "HTTP 404"} and out["new"] == 1

def test_load_sources_from_vendored_config():
    srcs, filters = jobs.load_sources(Path(__file__).parents[1] / "config")
    assert len(srcs) > 20 and filters.include.pattern

def test_existing_posting_not_reset_to_new():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board["greenhouse:stripe"] = [J(1)]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    db.update("postings", {}, {"status": "dismissed"})
    st = db.select("worker_state")[0]["value"]
    st["sources"]["greenhouse:stripe"]["seen"].clear()
    db.update("worker_state", {"key": "jobs"}, {"value": st})
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert [r["status"] for r in db.select("postings")] == ["dismissed"]

def test_applied_posting_kept_as_is():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board["greenhouse:stripe"] = [J(1)]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    db.update("postings", {}, {"status": "applied"})
    st = db.select("worker_state")[0]["value"]
    st["sources"]["greenhouse:stripe"]["seen"].clear()
    db.update("worker_state", {"key": "jobs"}, {"value": st})
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert [r["status"] for r in db.select("postings")] == ["applied"]

def test_unsafe_url_stored_as_none():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    bad = Job("Stripe", "Software Engineer Intern", "New York, NY", "javascript:alert(1)", None, "9")
    board["greenhouse:stripe"] = [bad]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert db.select("postings")[0]["url"] is None


def test_new_company_brings_its_recent_matches_only():
    db = MemoryDB()
    recent = Job("Stripe", "Software Engineer Intern", "New York, NY", "https://x/r", "2026-10-01T00:00:00Z", "r")
    old = Job("Stripe", "New Grad Engineer", "New York, NY", "https://x/o", "2026-06-01T00:00:00Z", "o")
    unknown = J(3)
    out = jobs.collect(db, sources(), FILTERS, None, NOW,
                       fetch=fake({"greenhouse:stripe": [recent, old, unknown], "ashby:ramp": []}))
    assert out["new"] == 1 and [r["title"] for r in db.select("postings")] == ["Software Engineer Intern"]
    # all three are now seen: a later run doesn't bring the old ones back
    out = jobs.collect(db, sources(), FILTERS, None, NOW,
                       fetch=fake({"greenhouse:stripe": [recent, old, unknown], "ashby:ramp": []}))
    assert out["new"] == 0


def test_new_github_list_still_seeds_silently():
    from job_radar.config import GitHubList
    srcs = build_sources([], [GitHubList(name="List", repo="a/b")])
    row = Job("Acme", "Software Engineer Intern", "NY", "https://x/1", "2026-10-13T00:00:00Z", "1")
    db = MemoryDB()
    out = jobs.collect(db, srcs, FILTERS, None, NOW, fetch=lambda s, sess, sha: ([row], "sha1"))
    assert out["new"] == 0 and db.select("postings") == []


def test_failing_board_alerts_once_after_six_runs_then_again_after_recovery():
    db = MemoryDB()
    ok = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(ok))
    bad = {"greenhouse:stripe": FetchError("HTTP 404"), "ashby:ramp": []}
    alerts = [jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(bad))["alert"] for _ in range(8)]
    assert alerts[:5] == [[]] * 5 and alerts[5] == ["Stripe: HTTP 404"] and alerts[6:] == [[], []]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(ok))  # recovers
    again = [jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(bad))["alert"] for _ in range(6)]
    assert again[-1] == ["Stripe: HTTP 404"]


def test_same_title_in_two_cities_is_two_postings():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    sf = Job("Stripe", "Software Engineer Intern", "San Francisco, CA", "https://x/sf", None, "sf")
    board["greenhouse:stripe"] = [J(1), sf]
    assert jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))["new"] == 2


def test_list_rows_for_companies_with_their_own_board_are_skipped():
    from job_radar.config import GitHubList
    srcs = build_sources([Company("Stripe", "greenhouse", "stripe", "reach")], [GitHubList(name="List", repo="a/b")])
    board = {"greenhouse:stripe": [], "github:a/b": []}
    fetch = lambda s, sess, sha: (board[s.key], None)
    db = MemoryDB()
    jobs.collect(db, srcs, FILTERS, None, NOW, fetch=fetch)
    board["github:a/b"] = [J(1, company="Stripe"), J(2, company="Acme")]
    out = jobs.collect(db, srcs, FILTERS, None, NOW, fetch=fetch)
    assert out["new"] == 1 and [r["company"] for r in db.select("postings")] == ["Acme"]


def test_new_undated_company_brings_all_its_matches():
    srcs = build_sources([Company("Meta", "meta", "meta", "reach")], [])
    db = MemoryDB()
    out = jobs.collect(db, srcs, FILTERS, None, NOW, fetch=lambda s, sess, sha: ([J(1, company="Meta")], None))
    assert out["new"] == 1


# ---- v3: dedupe, full-posting checks, refiling the inbox, alerts ----

def _primed(db, srcs=None, board=None):
    board = board or {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, srcs or sources(), FILTERS, None, NOW, fetch=fake(board))
    return board


def test_same_job_worded_differently_on_a_list_is_one_posting():
    from job_radar.config import GitHubList
    srcs = build_sources([Company("Ramp", "ashby", "ramp", "reach")], [GitHubList(name="List", repo="a/b")])
    board = {"ashby:ramp": [], "github:a/b": []}
    fetch = lambda s, sess, sha: (board[s.key], None)
    db = MemoryDB()
    jobs.collect(db, srcs, FILTERS, None, NOW, fetch=fetch)
    board["ashby:ramp"] = [Job("Ramp", "Software Engineer, New Grad (2027)", "New York, NY", "https://jobs.ashbyhq.com/ramp/1", None, "1")]
    board["github:a/b"] = [Job("Ramp Inc.", "New Graduate Software Engineer", "NYC", "https://jobs.ashbyhq.com/ramp/1?utm_source=list", None, "l1"),
                           Job("Ramp, Inc", "New Grad Software Engineer", "New York", "https://ramp.com/careers/x", None, "l2")]
    out = jobs.collect(db, srcs, FILTERS, None, NOW, fetch=fetch)
    assert out["new"] == 1 and out["dupes"] == 2


def test_dismissed_posting_does_not_come_back_from_another_source():
    db = MemoryDB()
    board = _primed(db)
    board["greenhouse:stripe"] = [J(1)]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    db.update("postings", {}, {"status": "dismissed"})
    board["ashby:ramp"] = [Job("Stripe", "Software Engineer Intern", "New York, NY", "https://other/1", None, "z")]
    assert jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))["new"] == 0


def test_posting_that_needs_experience_is_filed_as_filtered():
    db = MemoryDB()
    board = _primed(db)
    board["greenhouse:stripe"] = [J(1), J(2, title="New Grad Engineer")]
    texts = {"1": "Requirements\n3+ years of professional experience", "2": "Graduating May 2027"}
    out = jobs.collect(db, sources(), FILTERS, object(), NOW, fetch=fake(board),
                       describe=lambda job, session, cache, ats=None, token=None: texts[job.id])
    rows = {r["title"]: r for r in db.select("postings")}
    assert out["new"] == 1 and out["filtered"] == 1
    assert rows["Software Engineer Intern"]["status"] == "filtered"
    assert rows["Software Engineer Intern"]["filtered_reason"] == "Needs 3+ years of experience"
    assert rows["New Grad Engineer"]["status"] == "new"


def test_unreadable_posting_stays_in_the_inbox():
    db = MemoryDB()
    board = _primed(db)
    board["greenhouse:stripe"] = [J(1)]
    def boom(*a, **k): raise RuntimeError("HTTP 500")
    out = jobs.collect(db, sources(), FILTERS, object(), NOW, fetch=fake(board), describe=boom)
    assert out["new"] == 1 and db.select("postings")[0]["status"] == "new"


def test_open_postings_are_refiled_and_retiered():
    db = MemoryDB()
    base = {"location": "Chicago, IL", "url": None, "term": None, "posted_at": None, "starred": False, "found_at": NOW.isoformat(),
            "filtered_reason": None}
    db.insert("postings", [
        {**base, "id": "a", "company": "Jane Street", "title": "Software Engineer Intern", "tier": "reach", "status": "new"},
        {**base, "id": "b", "company": "Acme", "title": "Senior Software Engineer", "tier": "volume", "status": "seen"},
        {**base, "id": "c", "company": "Acme", "title": "New Grad Engineer", "tier": "volume", "status": "new"},
        {**base, "id": "d", "company": "Stripe", "title": "New Grad Engineer", "tier": "volume", "status": "new"},
        {**base, "id": "e", "company": "Acme", "title": "Senior Thing", "tier": "volume", "status": "dismissed"},
    ])
    filters = Filters(include=FILTERS.include, exclude=FILTERS.exclude, location=LocationRules(),
                      company_exclude=re.compile(r"jane street", re.I))
    out = jobs.collect(db, sources(), filters, None, NOW, fetch=fake({"greenhouse:stripe": [], "ashby:ramp": []}))
    rows = {r["id"]: r for r in db.select("postings")}
    assert (rows["a"]["status"], rows["a"]["filtered_reason"]) == ("filtered", "Trading firm")
    assert (rows["b"]["status"], rows["b"]["filtered_reason"]) == ("filtered", jobs.TITLE_RULE)
    assert (rows["c"]["status"], rows["c"]["tier"]) == ("new", "midwest")  # unknown company in Chicago
    assert rows["d"]["tier"] == "reach"                                     # Stripe is reach wherever it is
    assert rows["e"]["status"] == "dismissed"                               # Adam's own choices are left alone
    assert out["refiled"] == 4


def test_claude_finds_are_not_refiled_by_title():
    db = MemoryDB()
    db.insert("postings", [{"id": "x", "company": "Acme", "title": "Founding Engineer", "location": None, "url": None,
                            "term": None, "tier": "volume", "status": "new", "found_by": "claude", "found_at": NOW.isoformat()}])
    strict = Filters(include=FILTERS.include, exclude=re.compile("founding", re.I), location=LocationRules())
    jobs.collect(db, sources(), strict, None, NOW, fetch=fake({"greenhouse:stripe": [], "ashby:ramp": []}))
    assert db.select("postings")[0]["status"] == "new"


def test_older_inbox_postings_are_read_a_few_per_run():
    db = MemoryDB()
    db.insert("postings", [{"id": str(i), "company": "Acme", "title": "New Grad Engineer", "location": None,
                            "url": f"https://boards.greenhouse.io/acme/jobs/{i}", "term": None, "tier": "volume",
                            "status": "new", "found_at": NOW.isoformat()} for i in range(jobs.MAX_RESCREEN + 5)])
    read = []
    def describe(job, session, cache, ats=None, token=None):
        read.append(job.id)
        return "PhD required." if job.id == "0" else "Graduating 2027"
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, object(), NOW, fetch=fake(board), describe=describe)
    assert len(read) == jobs.MAX_RESCREEN
    assert next(r for r in db.select("postings") if r["id"] == "0")["filtered_reason"] == "Needs a PhD"
    jobs.collect(db, sources(), FILTERS, object(), NOW, fetch=fake(board), describe=describe)
    assert len(read) == jobs.MAX_RESCREEN + 5  # the rest on the next run, nothing twice


def test_fresh_postings_for_alerts_skip_new_sources_and_old_posts():
    db = MemoryDB()
    board = _primed(db)
    old = Job("Stripe", "New Grad Engineer", "New York, NY", "https://x/o", "2026-10-01T00:00:00Z", "o")
    board["greenhouse:stripe"] = [J(1), old]
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert [r["title"] for r in out["fresh"]] == ["Software Engineer Intern"]
    assert out["lag_min"] == -1  # nothing recent with a post time


def test_alerts_send_reach_and_midwest_one_by_one_and_roll_up_volume():
    rows = [{"company": "Acme", "title": "SWE", "tier": "volume", "location": "Austin, TX"},
            {"company": "Stripe", "title": "New Grad", "tier": "reach", "location": "NYC", "url": "https://s", "starred": True},
            {"company": "Allstate", "title": "SWE I", "tier": "midwest", "location": "Chicago, IL", "term": None}]
    out = jobs.alerts(rows, "https://lockin.example")
    assert [(t, p) for t, _, p, _ in out] == [("⭐ Stripe — New Grad", "high"), ("Allstate — SWE I", "default"),
                                             ("1 more new postings", "low")]
    assert out[0][1] == "Reach · NYC" and out[0][3] == "https://s" and out[2][3] == "https://lockin.example/hunt/jobs"


def test_url_key_and_title_key():
    assert jobs.url_key("https://www.Stripe.com/jobs/123/?utm_source=x&gh_jid=9") == "stripe.com/jobs/123?gh_jid=9"
    assert jobs.title_key("Software Engineer, New Grad (2027)") == jobs.title_key("New Graduate Software Engineer")
    assert jobs.title_key("Software Engineer I") != jobs.title_key("Software Engineer II")
    assert jobs.cities("San Francisco, CA; NYC") == {"san francisco", "new york"}


def test_untiered_outreach_and_referrals_get_a_tier():
    db = MemoryDB()
    db.insert("postings", [{"id": "p", "company": "Acme", "title": "SWE", "url": "https://acme/1", "location": "Detroit, MI"}])
    db.insert("outreach", [{"id": "o1", "company": "Acme", "job_url": "https://acme/1", "tier": None},
                           {"id": "o2", "company": None, "job_url": "https://x", "tier": None},
                           {"id": "o3", "company": "Stripe", "job_url": "https://y", "tier": "volume"}])
    db.insert("referrals", [{"id": "r1", "company": "Stripe", "job_url": None, "tier": None}])
    idx = jobs.tier_index(sources())
    assert jobs.tier_untiered(db, idx) == 2
    assert [o["tier"] for o in db.select("outreach")] == ["midwest", None, "volume"]
    assert db.select("referrals")[0]["tier"] == "reach"


def test_a_posting_adam_restored_is_never_refiled():
    db = MemoryDB()
    db.insert("postings", [{"id": "k", "company": "Acme", "title": "Senior Software Engineer", "location": None, "url": "https://boards.greenhouse.io/acme/jobs/1",
                            "term": None, "tier": "volume", "status": "new", "filtered_reason": jobs.KEPT, "found_at": NOW.isoformat()}])
    jobs.collect(db, sources(), FILTERS, object(), NOW, fetch=fake({"greenhouse:stripe": [], "ashby:ramp": []}),
                 describe=lambda *a, **k: "PhD required.")
    assert db.select("postings")[0]["status"] == "new"
